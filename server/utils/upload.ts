import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import type { H3Event } from 'h3'
import { createEventStream } from 'h3'
import { useRuntimeConfig } from '#imports'
import { useAI, useVectorize } from './hub'
import { getDocumentProxy, extractText } from 'unpdf'
import { documents, documentChunks } from '../database/schema'

const config = useRuntimeConfig()

interface UploadResult {
  path: string
  publicUrl: string
}

interface DocumentInsertResult {
  insertedId: string
}

interface ChunkInsertResult {
  insertedChunkId: string
}

/**
 * Sube un PDF a Supabase Storage y devuelve la URL pública
 * @param file Archivo PDF a subir
 * @param sessionId ID de sesión para organizar los archivos
 * @returns Objeto con path y publicUrl
 */
export async function uploadPDFToSupabase(
  file: File,
  sessionId: string,
): Promise<UploadResult> {
  const supabase = useSupabaseClient()
  const bucket = config.public.supabaseBucket
  const path = `uploads/${sessionId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`

  try {
    // Validaciones del archivo
    if (file.type !== 'application/pdf') {
      throw new Error('Only PDF files are allowed')
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`)
    }

    // Verificar conexión con Supabase
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets()
    if (bucketError) {
      throw new Error(`Failed to list buckets: ${bucketError.message}`)
    }
    if (!buckets?.some(b => b.name === bucket)) {
      throw new Error(`Bucket "${bucket}" does not exist`)
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
      throw uploadError
    }

    // Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path)

    if (!publicUrl) {
      throw new Error('Failed to generate public URL')
    }

    return {
      path: data.path,
      publicUrl,
    }
  }
  catch (error) {
    console.error('PDF upload error:', error)
    throw new Error(
      `Failed to upload PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Extrae texto de un archivo PDF
 * @param file Archivo PDF
 * @returns Texto extraído
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    if (file.type !== 'application/pdf') {
      throw new Error('File is not a valid PDF')
    }

    const buffer = await file.arrayBuffer()
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const result = await extractText(pdf, { mergePages: true })

    const text = Array.isArray(result.text) ? result.text.join(' ') : result.text
    return text.trim() || ' '
  }
  catch (error) {
    console.error('Text extraction error:', error)
    throw new Error(
      `Failed to extract text: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Inserta un documento en la base de datos
 * @param file Archivo subido
 * @param textContent Texto extraído del PDF
 * @param sessionId ID de sesión
 * @param storageUrl URL de almacenamiento en Supabase
 * @returns ID del documento insertado
 */
export async function insertDocument(
  file: File,
  textContent: string,
  sessionId: string,
  storageUrl: string,
): Promise<string> {
  try {
    const row = {
      name: file.name,
      size: file.size,
      text_content: textContent,
      session_id: sessionId,
      storage_path: storageUrl,
      created_at: new Date().toISOString(),
      status: 'uploaded' as const,
    }

    const result = await useDrizzle()
      .insert('documents')
      .values(row)
      .returning({ insertedId: documents.id })

    if (!result?.[0]?.insertedId) {
      throw new Error('Document insertion failed: No ID returned')
    }

    return result[0].insertedId
  }
  catch (error) {
    console.error('Document insertion error:', error)
    throw new Error(
      `Failed to insert document: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

export async function processVectors(
  chunks: string[],
  sessionId: string,
  documentId: string,
  streamResponse: (message: object) => Promise<void>,
): Promise<void> {
  const BATCH_SIZE = 5
  const TOTAL_CHUNKS = chunks.length
  let processed = 0

  try {
    await streamResponse({
      message: 'Starting vector processing...',
      totalChunks: TOTAL_CHUNKS,
    })

    for (let i = 0; i < TOTAL_CHUNKS; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)

      // Generar embeddings
      const { data: embeddings } = await useAI().generateEmbeddings(batch)

      // Insertar chunks en la base de datos
      const chunkInsertResults = await useDrizzle()
        .insert(documentChunks)
        .values(
          batch.map(chunk => ({
            text: chunk,
            session_id: sessionId,
            document_id: documentId,
          })),
        )
        .returning({ insertedChunkId: documentChunks.id })

      // Insertar vectores
      await useVectorize().insert(
        embeddings.map((embedding: number[], idx: number) => ({
          id: chunkInsertResults[idx].insertedChunkId,
          values: embedding,
          namespace: 'default',
          metadata: {
            sessionId,
            documentId,
            chunkId: chunkInsertResults[idx].insertedChunkId,
            text: batch[idx],
          },
        })),
      )

      // Actualizar progreso
      processed += batch.length
      const progress = Math.round((processed / TOTAL_CHUNKS) * 100)

      await streamResponse({
        message: `Processing chunks... (${progress}%)`,
        chunksProcessed: processed,
        totalChunks: TOTAL_CHUNKS,
      })
    }

    await streamResponse({
      message: 'Vector processing completed',
      success: true,
    })
  }
  catch (error) {
    console.error('Vector processing error:', error)
    await streamResponse({
      error: `Vector processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
    throw error
  }
}
/**
 * Divide texto en chunks para procesamiento
 * @param text Texto a dividir
 * @param chunkSize Tamaño de cada chunk (default: 500)
 * @param overlap Superposición entre chunks (default: 100)
 * @returns Array de chunks de texto
 */
export async function splitTextIntoChunks(
  text: string,
  chunkSize = 500,
  overlap = 100,
): Promise<string[]> {
  try {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap: overlap,
    })
    return await splitter.splitText(text)
  }
  catch (error) {
    console.error('Text splitting error:', error)
    throw new Error(
      `Failed to split text: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Procesamiento completo de un documento PDF
 * @param file Archivo PDF
 * @param sessionId ID de sesión
 * @param event Evento H3 para streaming
 * @returns Resultado del procesamiento
 */
export async function processPDFDocument(
  file: File,
  sessionId: string,
  event: H3Event,
) {
  const streamResponse = async (data: object) => {
    const eventStream = createEventStream(event)
    await eventStream.push(JSON.stringify(data))
  }

  try {
    await streamResponse({ message: 'Validating PDF...' })

    // Validar tamaño del archivo
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size exceeds 10MB limit')
    }

    await streamResponse({ message: 'Starting PDF processing...' })

    // Procesar en paralelo
    const [storageResult, textContent] = await Promise.all([
      uploadPDFToSupabase(file, sessionId),
      extractTextFromPDF(file),
    ])

    await streamResponse({ message: 'PDF uploaded and text extracted' })

    // Insertar documento en DB
    const documentId = await insertDocument(
      file,
      textContent,
      sessionId,
      storageResult.path,
    )

    await streamResponse({ message: `Document stored with ID: ${documentId}` })

    // Dividir texto en chunks
    const chunks = await splitTextIntoChunks(textContent)
    await streamResponse({ message: `Text split into ${chunks.length} chunks` })

    // Procesar vectores
    await processVectors(chunks, sessionId, documentId, streamResponse)

    return {
      success: true,
      documentId,
      chunks: chunks.length,
      storagePath: storageResult.path,
    }
  }
  catch (error) {
    console.error('Document processing error:', error)
    await streamResponse({
      error: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
    throw error
  }
}
