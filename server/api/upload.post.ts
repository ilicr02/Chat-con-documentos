import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { getDocumentProxy, extractText } from 'unpdf'
import { useSupabaseClient } from '#imports'
import { useCloudflare } from '~/server/utils/cloudflare'

interface DocumentMetadata {
  name: string
  size: number
  sessionId: string
  supabaseUrl: string
  supabasePath: string
  textContent: string
}

interface EmbeddingResponse {
  result: {
    data: number[][]
    shape: number[]
  }
}

export default defineEventHandler(async (event) => {
  // 1. Obtener y validar datos del formulario
  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({ statusCode: 400, message: 'No form data received' })
  }

  const sessionIdData = formData.find(f => f.name === 'sessionId')?.data
  const fileData = formData.find(f => f.name === 'file')

  if (!sessionIdData || !fileData) {
    throw createError({ statusCode: 400, message: 'Missing sessionId or file' })
  }

  const sessionId = sessionIdData.toString()
  const file = new File([fileData.data], fileData.filename || 'document.pdf', {
    type: fileData.type || 'application/pdf',
  })

  // Validar tamaño del archivo
  if (file.size > 10 * 1024 * 1024) {
    throw createError({ statusCode: 400, message: 'File size exceeds 10MB limit' })
  }

  // Configurar stream de eventos
  const eventStream = createEventStream(event)
  const streamResponse = (data: object) => eventStream.push(JSON.stringify(data))

  // Procesamiento en segundo plano
  event.waitUntil((async () => {
    try {
      // 2. Subir PDF a Supabase
      streamResponse({ message: 'Uploading to Supabase Storage...' })
      const { publicUrl, storagePath } = await uploadPDFToSupabase(file, sessionId)

      // 3. Extraer texto del PDF
      streamResponse({ message: 'Extracting text from PDF...' })
      const textContent = await extractTextFromPDFBuffer(new Uint8Array(fileData.data).buffer)

      // 4. Guardar metadatos en D1
      streamResponse({ message: 'Storing document metadata...' })
      const documentId = await storeDocumentMetadata({
        name: file.name,
        size: file.size,
        sessionId,
        supabaseUrl: publicUrl,
        supabasePath: storagePath,
        textContent,
      })

      // 5. Dividir texto en chunks
      streamResponse({ message: 'Splitting text into chunks...' })
      const chunks = await new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 100,
      }).splitText(textContent)

      streamResponse({ message: `Text split into ${chunks.length} chunks` })

      // 6. Procesar chunks y generar embeddings
      streamResponse({ message: 'Processing text chunks and embeddings...' })
      await processDocumentChunks(chunks, sessionId, documentId, (progress) => {
        streamResponse({
          message: 'Processing chunks...',
          progress: Math.round(progress),
        })
      })

      // 7. Notificar éxito
      streamResponse({
        success: true,
        documentId,
        chunks: chunks.length,
        supabaseUrl: publicUrl,
      })
    }
    catch (error) {
      console.error('Upload error:', error)
      streamResponse({
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    finally {
      eventStream.close()
    }
  })())

  return eventStream.send()
})

// Función para subir PDF a Supabase Storage
async function uploadPDFToSupabase(file: File, sessionId: string): Promise<{ publicUrl: string, storagePath: string }> {
  const supabase = useSupabaseClient()
  const bucket = useRuntimeConfig().public.supabaseBucket || 'documents'
  const path = `uploads/${sessionId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    })

  if (error) throw new Error(`Supabase upload failed: ${error.message}`)

  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(data.path)
  if (!publicUrl) throw new Error('Failed to generate public URL')

  return { publicUrl, storagePath: data.path }
}

// Función para extraer texto de PDF
async function extractTextFromPDFBuffer(buffer: ArrayBuffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const result = await extractText(pdf, { mergePages: true })
    return Array.isArray(result.text) ? result.text.join(' ') : result.text
  }
  catch (error) {
    throw new Error(`Text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Función para guardar metadatos en D1
async function storeDocumentMetadata(data: DocumentMetadata): Promise<string> {
  const { database } = useCloudflare()
  const db = database()

  const result = await db.prepare(
    `INSERT INTO documents (name, size, session_id, storage_path, public_url, text_content, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'uploaded', datetime('now'))
     RETURNING id`,
  ).bind(
    data.name,
    data.size,
    data.sessionId,
    data.supabasePath,
    data.supabaseUrl,
    data.textContent,
  ).first<{ id: string }>()

  if (!result?.id) throw new Error('Document insertion failed')
  return result.id
}

// Función para procesar chunks y generar embeddings
async function processDocumentChunks(
  chunks: string[],
  sessionId: string,
  documentId: string,
  progressCallback?: (progress: number) => void,
): Promise<void> {
  const { ai, vectorize, database } = useCloudflare()
  const batchSize = 5

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)

    // 1. Definir tipo explícito para la respuesta de embeddings
    interface AIEmbeddingResponse {
      result: {
        data: number[][]
        shape: number[]
      }
      success: boolean
      errors: string[]
    }

    // Generar embeddings con Cloudflare AI
    const response = await ai().run<AIEmbeddingResponse>('@cf/baai/bge-base-en-v1.5', {
      text: batch,
    })

    if (!response || !response.success || !response.result?.data) {
      const errorMsg = response?.errors?.join(', ') || 'Invalid response format'
      throw new Error(`Failed to generate embeddings: ${errorMsg}`)
    }

    const embeddings = response.result.data

    // Insertar chunks en D1
    const insertResults = await Promise.all(
      batch.map(chunk => {
        return database()
          .prepare(
            `INSERT INTO document_chunks (text, session_id, document_id)
             VALUES (?, ?, ?) RETURNING id`,
          )
          .bind(chunk, sessionId, documentId)
          .first<{ id: string }>()
          .catch(e => {
            console.error(`Error inserting chunk: ${e.message}`)
            return null
          })
      }),
    )

    // 5. Validar y filtrar resultados
    const validResults = insertResults.filter((result): result is { id: string } => {
      if (!result?.id) {
        console.warn('Invalid or missing chunk insertion result')
        return false
      }
      return true
    })

    if (validResults.length !== batch.length) {
      throw new Error(`Failed to insert all chunks (${validResults.length}/${batch.length} succeeded)`)
    }

    // 6. Preparar vectores para Vectorize con validación
    const vectors = embeddings.map((embedding: number[], idx: number) => {
      const result = validResults[idx]
      if (!result) {
        throw new Error(`Missing valid insertion result for chunk ${idx}`)
      }
      return {
        id: result.id,
        values: embedding,
        metadata: {
          sessionId,
          documentId,
          text: batch[idx].substring(0, 100) + '...',
        },
      }
    })

    // 7. Insertar en Vectorize con manejo de errores
    try {
      await vectorize().upsert(vectors)
    }
    catch (e) {
      throw new Error(`Vectorize upsert failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }

    // Actualizar progreso
    progressCallback?.(Math.min(((i + batchSize) / chunks.length) * 100, 100))
  }
}
