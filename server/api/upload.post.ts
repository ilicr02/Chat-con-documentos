// server/api/upload.post.ts
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { getDocumentProxy, extractText } from 'unpdf'
import { z } from 'zod'

const uploadSchema = z.object({
  sessionId: z.string().min(1),
  file: z.custom<File>(val => val instanceof File, {
    message: 'File is required'
  })
})

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event)
  if (!formData) throw createError({ statusCode: 400, message: 'No form data received' })

  const sessionIdData = formData.find(f => f.name === 'sessionId')?.data
  const fileData = formData.find(f => f.name === 'file')

  if (!sessionIdData || !fileData) {
    throw createError({ statusCode: 400, message: 'Missing sessionId or file' })
  }

  const sessionId = sessionIdData.toString()
  const file = new File([fileData.data], fileData.filename || 'document.pdf', {
    type: fileData.type || 'application/pdf'
  })

  // Validación con Zod
  try {
    uploadSchema.parse({ sessionId, file })
  } catch (error) {
    throw createError({ 
      statusCode: 400, 
      message: error instanceof z.ZodError 
        ? error.errors.map(e => e.message).join(', ')
        : 'Invalid input'
    })
  }

  // Validación adicional del archivo
  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
  if (file.size > MAX_FILE_SIZE) {
    throw createError({ 
      statusCode: 400, 
      message: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`
    })
  }

  if (file.type !== 'application/pdf') {
    throw createError({ statusCode: 400, message: 'Only PDF files are allowed' })
  }

  // Crear stream de eventos
  const eventStream = createEventStream(event)
  const streamResponse = (data: object) => eventStream.push(JSON.stringify(data))

  // Procesamiento en segundo plano
  event.waitUntil((async () => {
    try {
      // 1. Subir PDF a Supabase Storage
      await streamResponse({ message: 'Uploading to Supabase Storage...' })
      const { publicUrl, path } = await uploadToSupabase(file, sessionId)

      // 2. Extraer texto del PDF (en paralelo con la subida)
      await streamResponse({ message: 'Extracting text from PDF...' })
      const textContent = await extractTextFromPDF(file)

      // 3. Insertar metadatos del documento en D1
      await streamResponse({ message: 'Storing document metadata...' })
      const documentId = await insertDocumentMetadata({
        name: file.name,
        size: file.size,
        sessionId,
        storagePath: path,
        publicUrl,
        textContent
      })

      // 4. Dividir texto en chunks
      await streamResponse({ message: 'Splitting text into chunks...' })
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 100,
      })
      const chunks = await splitter.splitText(textContent)

      await streamResponse({ message: `Text split into ${chunks.length} chunks` })

      // 5. Procesar chunks y generar embeddings
      await streamResponse({ message: 'Processing text chunks and embeddings...' })
      await processDocumentChunks(chunks, sessionId, documentId, (progress) => {
        streamResponse({
          message: 'Processing chunks...',
          progress: Math.round(progress),
          chunksProcessed: Math.floor((progress / 100) * chunks.length),
          totalChunks: chunks.length
        })
      })

      // 6. Notificar éxito
      streamResponse({
        success: true,
        documentId,
        chunks: chunks.length,
        publicUrl
      })
    } catch (error) {
      console.error('Upload processing error:', error)
      streamResponse({
        error: error instanceof Error ? error.message : 'Upload processing failed'
      })
    } finally {
      eventStream.close()
    }
  })())

  return eventStream.send()
})

// Función para subir PDF a Supabase Storage
async function uploadToSupabase(file: File, sessionId: string): Promise<{ publicUrl: string, path: string }> {
  const supabase = useSupabaseClient()
  const bucket = useRuntimeConfig().public.supabaseBucket || 'documents'
  const path = `uploads/${sessionId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`

  // Verificar conexión con Supabase
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets()
  if (bucketError) {
    throw new Error(`Failed to connect to Supabase: ${bucketError.message}`)
  }
  if (!buckets?.some(b => b.name === bucket)) {
    throw new Error(`Bucket "${bucket}" does not exist in Supabase`)
  }

  // Subir el archivo
  const { data, error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    })

  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`)
  }

  // Obtener URL pública
  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(data.path)

  if (!publicUrl) {
    throw new Error('Failed to generate public URL from Supabase')
  }

  return {
    publicUrl,
    path: data.path
  }
}

// Función para extraer texto de PDF
async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer()
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const result = await extractText(pdf, { mergePages: true })
    return Array.isArray(result.text) ? result.text.join(' ') : result.text
  } catch (error) {
    throw new Error(`PDF text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Función para insertar metadatos del documento en D1
async function insertDocumentMetadata(data: {
  name: string
  size: number
  sessionId: string
  storagePath: string
  publicUrl: string
  textContent: string
}): Promise<string> {
  try {
    const result = await useDrizzle()
      .insert(documents)
      .values({
        name: data.name,
        size: data.size,
        session_id: data.sessionId,
        storage_path: data.storagePath,
        public_url: data.publicUrl,
        text_content: data.textContent,
        status: 'processed',
        created_at: new Date().toISOString()
      })
      .returning({ insertedId: documents.id })

    if (!result?.[0]?.insertedId) {
      throw new Error('Document metadata insertion failed: No ID returned')
    }

    return result[0].insertedId
  } catch (error) {
    throw new Error(`Failed to insert document metadata: ${error instanceof Error ? error.message : 'Database error'}`)
  }
}

// Función para procesar chunks y generar embeddings
async function processDocumentChunks(
  chunks: string[],
  sessionId: string,
  documentId: string,
  progressCallback?: (progress: number) => void
): Promise<void> {
  const BATCH_SIZE = 5
  const TOTAL_CHUNKS = chunks.length

  for (let i = 0; i < TOTAL_CHUNKS; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)

    try {
      // 1. Generar embeddings para el batch actual
      const { data: embeddings } = await useAI().run('@cf/baai/bge-base-en-v1.5', {
        text: batch
      })

      // 2. Insertar chunks en D1
      const chunkInsertResults = await useDrizzle()
        .insert(documentChunks)
        .values(
          batch.map((chunk, idx) => ({
            id: `${documentId}-chunk-${i + idx}`,
            text: chunk,
            session_id: sessionId,
            document_id: documentId,
            embedding: JSON.stringify(embeddings[idx]) // Opcional: guardar embedding en D1
          }))
        )
        .returning({ insertedChunkId: documentChunks.id })

      // 3. Insertar vectores en Vectorize
      await useVectorize().upsert(
        embeddings.map((embedding: number[], idx: number) => ({
          id: chunkInsertResults[idx].insertedChunkId,
          values: embedding,
          metadata: {
            sessionId,
            documentId,
            chunkIndex: i + idx,
            textPreview: batch[idx].substring(0, 100) + '...',
          },
        })),
      )

      // Actualizar progreso
      if (progressCallback) {
        const progress = Math.min(((i + BATCH_SIZE) / TOTAL_CHUNKS) * 100, 100)
        progressCallback(progress)
      }
    }
    catch (error) {
      console.error(`Error processing batch ${i}-${i + BATCH_SIZE}:`, error)
      throw new Error(`Failed to process document chunks: ${error instanceof Error ? error.message : 'Batch processing error'}`)
    }
  }
}
