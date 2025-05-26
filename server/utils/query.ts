import type { RoleScopedChatInput } from '@cloudflare/workers-types'
import { inArray, sql } from 'drizzle-orm'
import { useAI, useVectorize } from './hub'
import { useDrizzle } from './drizzle'
import { documentChunks } from '../database/schema'
import type { H3Event } from 'h3'

// Definición de tipos mejorados
interface VectorizeMatch {
  id: string
  score: number
  values?: number[]
  metadata?: Record<string, unknown>
}

interface VectorizeMatches {
  matches: VectorizeMatch[]
  namespace?: string
}

interface DocumentChunk {
  id: string
  text: string
  documentId: string
  sessionId: string
  embeddingId?: string
}

type DocumentChunkResult = DocumentChunk & { rank: number }

interface QueryProcessingResult {
  messages: RoleScopedChatInput[]
  relevantDocs?: DocumentChunk[]
  queries?: string[]
}

interface RankedResult {
  id: string
  score: number
}

const SYSTEM_MESSAGE = `You are a helpful assistant that answers questions based on the provided context. 
When giving a response, always cite your sources using the format [1], [2], etc. corresponding to the document chunks provided.`

const RANKING_CONSTANT = 60 // Constante para Reciprocal Rank Fusion

/**
 * Reescribe un mensaje de usuario en múltiples consultas de búsqueda
 * @param content Contenido del mensaje del usuario
 * @returns Array de consultas de búsqueda
 */
async function rewriteToQueries(content: string): Promise<string[]> {
  try {
    const prompt = `Given the following user message, generate 5 distinct search queries that cover different aspects of the message.
Each query should be a concise phrase optimized for information retrieval. Return one query per line.

User message: "${content}"

Generated queries:`

    const { response } = await useAI().run('@cf/meta/llama-3.1-8b-instruct', {
      model: '@cf/meta/llama-3.1-8b-instruct',
      prompt,

    }) as { response: string }

    return response
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 0)
      .slice(0, 5)
  }
  catch (error) {
    console.error('Query rewriting error:', error)
    // Fallback: usar el contenido original como única consulta
    return [content]
  }
}

/**
 * Busca chunks de documento usando búsqueda de texto completo
 * @param searchTerms Términos de búsqueda
 * @returns Array de chunks de documento con ranking
 */
async function searchDocumentChunks(searchTerms: string[]): Promise<DocumentChunkResult[]> {
  try {
    const queries = searchTerms.map(term => {
      const sanitizedTerm = term.trim().replace(/[^\w\s]/g, '')
      return sql`
        SELECT document_chunks.*, document_chunks_fts.rank
        FROM document_chunks_fts
        JOIN document_chunks ON document_chunks_fts.id = document_chunks.id
        WHERE document_chunks_fts MATCH ${sanitizedTerm}
        ORDER BY rank DESC
        LIMIT 5
      `
    })

    const results = await Promise.all(
      queries.map(async query => {
        const { results } = (await useDrizzle().run(query)) as { results: DocumentChunkResult[] }
        return results ?? []
      }),
    )

    return results
      .flat()
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .slice(0, 10)
  }
  catch (error) {
    console.error('Full-text search error:', error)
    return []
  }
}

/**
 * Combina resultados de búsqueda usando Reciprocal Rank Fusion
 * @param fullTextResults Resultados de búsqueda de texto completo
 * @param vectorResults Resultados de búsqueda vectorial
 * @returns Array de resultados combinados y rankeados
 */
function performReciprocalRankFusion(
  fullTextResults: DocumentChunkResult[],
  vectorResults: VectorizeMatches[],
): RankedResult[] {
  const scores: Record<string, number> = {}

  // Procesar resultados de texto completo
  fullTextResults.forEach((result, index) => {
    if (!result?.id) return
    const score = 1 / (RANKING_CONSTANT + index + 1)
    scores[result.id] = (scores[result.id] || 0) + score
  })

  // Procesar resultados vectoriales
  vectorResults.forEach(result => {
    result.matches?.forEach((match, index) => {
      if (!match?.id) return
      const score = 1 / (RANKING_CONSTANT + index + 1)
      scores[match.id] = (scores[match.id] || 0) + score
    })
  })

  return Object.entries(scores)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Consulta el índice vectorial con múltiples consultas
 * @param queries Consultas de búsqueda
 * @param sessionId ID de sesión
 * @returns Resultados de búsqueda vectorial
 */
async function queryVectorIndex(queries: string[], sessionId: string): Promise<VectorizeMatches[]> {
  try {
    const queryVectors = await Promise.all(
      queries.map(q =>
        useAI().run('@cf/baai/bge-large-en-v1.5', {
          text: [q],
        }),
      ),
    )

    return await Promise.all(
      queryVectors.map(async qv => {
        const vector = (qv as { data: number[][] }).data[0]
        return await useVectorize().query(vector, {
          topK: 5,
          returnValues: true,
          returnMetadata: true,
          filter: { sessionId },
        }) as VectorizeMatches
      }),
    )
  }
  catch (error) {
    console.error('Vector search error:', error)
    return []
  }
}

/**
 * Obtiene documentos relevantes por sus IDs
 * @param ids IDs de los documentos
 * @returns Array de chunks de documento
 */
async function getRelevantDocuments(ids: string[]): Promise<DocumentChunk[]> {
  if (!ids.length) return []

  try {
    return await useDrizzle()
      .select({
        id: documentChunks.id,
        text: documentChunks.text,
        documentId: documentChunks.document_id,
        sessionId: documentChunks.session_id,
      })
      .from(documentChunks)
      .where(inArray(documentChunks.id, ids))
  }
  catch (error) {
    console.error('Error fetching relevant docs:', error)
    return []
  }
}

/**
 * Formatea el contexto para el LLM
 * @param docs Documentos relevantes
 * @returns Texto formateado con referencias
 */
function formatContext(docs: DocumentChunk[]): string {
  return docs
    .map((doc, idx) => `[${idx + 1}]: ${doc.text}`)
    .join('\n\n')
}

/**
 * Procesa una consulta del usuario usando RAG híbrido
 * @param sessionId ID de sesión
 * @param messages Historial de mensajes
 * @param streamResponse Función para enviar actualizaciones
 * @returns Objeto con mensajes actualizados y contexto
 */
export async function processUserQuery(
  { sessionId, messages }: { sessionId: string, messages: RoleScopedChatInput[] },
  streamResponse: (data: object) => Promise<void>,
): Promise<QueryProcessingResult> {
  try {
    // Validación de entrada
    if (!sessionId) throw new Error('Session ID is required')
    if (!messages?.length) throw new Error('No messages provided')

    const lastMessage = messages[messages.length - 1]
    if (!lastMessage?.content) throw new Error('Last message has no content')

    // Agregar mensaje del sistema
    const systemMessage = { role: 'system' as const, content: SYSTEM_MESSAGE }
    messages.unshift(systemMessage)

    await streamResponse({ message: 'Analyzing query...' })
    const query = lastMessage.content
    const queries = await rewriteToQueries(query)

    await streamResponse({
      message: 'Searching documents...',
      queries,
    })

    // Búsqueda paralela
    const [textResults, vectorResults] = await Promise.all([
      searchDocumentChunks(queries),
      Promise.all(
        queries.map(async q => {
          const vector = (await useAI().generateEmbeddings([q])).data[0]
          return await useVectorize().query(vector, {
            topK: 5,
            returnValues: true,
            returnMetadata: true,
            filter: { sessionId },
          })
        }),
      ),
    ])

    // Combinar y rankear resultados
    const rankedResults = performReciprocalRankFusion(textResults, vectorResults)
    const topIds = rankedResults.slice(0, 10).map(r => r.id)
    const relevantDocs = await getRelevantDocuments(topIds)

    await streamResponse({
      message: 'Compiling context...',
      found: relevantDocs.length,
    })

    // Construir contexto
    const context = formatContext(relevantDocs)
    messages.push({
      role: 'assistant',
      content: `Context from documents:\n${context}`,
    })

    return {
      messages,
      relevantDocs,
      queries,
    }
  }
  catch (error) {
    console.error('Query processing error:', error)
    await streamResponse({
      error: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
    throw error
  }
}

/**
 * Manejador de consultas para endpoint API
 */
export default defineEventHandler(async (event: H3Event) => {
  const { messages, sessionId } = await readBody(event)
  const eventStream = createEventStream(event)

  const streamResponse = (data: object) => {
    eventStream.push(JSON.stringify(data))
  }

  try {
    const result = await processUserQuery(
      { sessionId, messages },
      streamResponse
    )

    // Generar respuesta con LLM
    const llmResponse = await useAI().run('@cf/meta/llama-3.1-8b-instruct', {
      messages: result.messages,
      stream: true,
    }) as ReadableStream

    // Stream de la respuesta
    const reader = llmResponse.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = new TextDecoder().decode(value)
      await streamResponse({ chunk })
    }

    return eventStream.close()
  }
  catch (error) {
    console.error('API handler error:', error)
    await streamResponse({
      error: `Failed to process query: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
    return eventStream.close()
  }
})
