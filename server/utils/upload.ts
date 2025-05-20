import { useRuntimeConfig } from '#imports'
import { useDrizzle, useAI, useVectorize } from './hub'
import { getDocumentProxy, extractText } from 'unpdf'
import { documents, documentChunks } from '../database/schema'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

const config = useRuntimeConfig()

/**
 * Sube un PDF a Supabase Storage y devuelve la URL pública
 * @param file Archivo PDF a subir
 * @param sessionId ID de sesión para organizar los archivos
 * @returns Objeto con path y publicUrl
 */
export async function uploadPDFToSupabase(
  file: File,
  sessionId: string,
): Promise<{ path: string, publicUrl: string }> {
  const supabase = useSupabaseClient()

  try {
    const bucket = config.public.supabaseBucket
    const path = `uploads/${sessionId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`

    // Validar tipo y tamaño del archivo
    if (file.type !== 'application/pdf') {
      throw new Error('Solo se permiten archivos PDF')
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`El archivo excede el tamaño máximo de ${MAX_FILE_SIZE / 1024 / 1024}MB`)
    }

    // Verificar conexión con Supabase
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets()
    if (bucketError) throw new Error(`Error al listar buckets: ${bucketError.message}`)
    if (!buckets?.some(b => b.name === bucket)) {
      throw new Error(`Bucket "${bucket}" no existe`)
    }

    // Subir el archivo
    const { data, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      })

    if (uploadError) throw uploadError

    // Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path)

    if (!publicUrl) throw new Error('No se pudo generar URL pública')

    return { path: data.path, publicUrl }
  }
  catch (error) {
    console.error('Error en uploadPDFToSupabase:', error)
    throw new Error(`Error al subir PDF: ${error instanceof Error ? error.message : String(error)}`)
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
      throw new Error('El archivo no es un PDF válido')
    }

    const buffer = await file.arrayBuffer()
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const result = await extractText(pdf, { mergePages: true })

    const text = Array.isArray(result.text) ? result.text.join(' ') : result.text
    return text.trim() || ' '
  }
  catch (error) {
    console.error('Error en extractTextFromPDF:', error)
    throw new Error(`Error al extraer texto: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Inserta un documento en la base de datos
 * @param file Archivo subido
 * @param textContent Texto extraído del PDF
 * @param sessionId ID de sesión
 * @param storageUrl URL de almacenamiento en Supabase
 * @returns Resultado de la inserción
 */
export async function insertDocument(
  file: File,
  textContent: string,
  sessionId: string,
  storageUrl: string,
) {
  try {
    const row = {
      name: file.name,
      size: file.size,
      text_content: textContent,
      session_id: sessionId,
      storage_path: storageUrl,
      created_at: new Date().toISOString(),
      status: 'uploaded',
    }

    const result = await useDrizzle()
      .insert(documents)
      .values(row)
      .returning({ insertedId: documents.id })

    if (!result || result.length === 0) {
      throw new Error('No se pudo insertar el documento')
    }

    return result[0].insertedId
  }
  catch (error) {
    console.error('Error en insertDocument:', error)
    throw new Error(`Error al insertar documento: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Procesa chunks de texto para generar embeddings
 * @param chunks Array de chunks de texto
 * @param sessionId ID de sesión
 * @param documentId ID del documento
 * @param streamResponse Función para enviar actualizaciones de progreso
 */
export async function processVectors(
  chunks: string[],
  sessionId: string,
  documentId: string,
  streamResponse: (message: object) => Promise<void>,
) {
  const chunkSize = 5
  let processedChunks = 0

  try {
    await streamResponse({ message: 'Iniciando procesamiento de vectores...' })

    for (let i = 0; i < chunks.length; i += chunkSize) {
      const chunkBatch = chunks.slice(i, i + chunkSize)

      // Generar embeddings
      const embeddingResult = await useAI().run('@cf/baai/bge-large-en-v1.5', {
        model: '@cf/baai/bge-large-en-v1.5',
        text: chunkBatch,
      })

      const embeddingBatch: number[][] = (embeddingResult as { data: number[][] }).data

      // Insertar chunks en la base de datos
      const chunkInsertResults = await useDrizzle()
        .insert(documentChunks)
        .values(
          chunkBatch.map(chunk => ({
            text: chunk,
            session_id: sessionId,
            document_id: documentId,
          })),
        )
        .returning({ insertedChunkId: documentChunks.id })

      // Insertar vectores
      await useVectorize().insert(
        embeddingBatch.map((embedding, idx) => ({
          id: chunkInsertResults[idx].insertedChunkId,
          values: embedding,
          namespace: 'default',
          metadata: {
            sessionId,
            documentId,
            chunkId: chunkInsertResults[idx].insertedChunkId,
            text: chunkBatch[idx],
          },
        })),
      )

      // Actualizar progreso
      processedChunks += chunkBatch.length
      const progress = Math.min(100, (processedChunks / chunks.length) * 100)

      await streamResponse({
        message: `Procesando chunks... (${progress.toFixed(1)}%)`,
        chunksProcessed: processedChunks,
        totalChunks: chunks.length,
      })
    }

    await streamResponse({ message: 'Procesamiento de vectores completado' })
  }
  catch (error) {
    console.error('Error en processVectors:', error)
    await streamResponse({
      error: `Error al procesar vectores: ${error instanceof Error ? error.message : String(error)}`,
    })
    throw error
  }
}

/**
 * Divide texto en chunks para procesamiento
 * @param text Texto a dividir
 * @param chunkSize Tamaño de cada chunk
 * @param overlap Superposición entre chunks
 * @returns Array de chunks de texto
 */
export async function splitTextIntoChunks(
  text: string,
  chunkSize = 500,
  overlap = 100,
): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: overlap,
  })
  return splitter.splitText(text)
}
