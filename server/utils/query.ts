import type { RoleScopedChatInput } from '@cloudflare/workers-types'
import { inArray, sql } from 'drizzle-orm'
import { useAI, useDrizzle, useVectorize } from './hub'
import { documentChunks } from '../database/schema'

// Definición de tipos necesarios
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

const SYSTEM_MESSAGE = `You are a helpful assistant that answers questions based on the provided context. When giving a response, always include the source of the information in the format [1], [2], [3] etc.`

async function rewriteToQueries(content: string): Promise<string[]> {
  const prompt = `Given the following user message, rewrite it into 5 distinct queries that could be used to search for relevant information. Each query should focus on different aspects or potential interpretations of the original message. No questions, just a query maximizing the chance of finding relevant information.

User message: "${content}"

Provide 5 queries, one per line and nothing else:`

  const { response } = await useAI().run('@cf/meta/llama-3.1-8b-instruct', { 
    model: '@cf/meta/llama-3.1-8b-instruct',
    prompt 
  }) as { response: string }

  const regex = /^\d+\.\s*"|"$/gm
  const queries = response
    .replace(regex, '')
    .split('\n')
    .filter(query => query.trim() !== '')
    .slice(0, 5) // Cambiado de slice(1,5) a slice(0,5) para obtener los primeros 5

  return queries
}

async function searchDocumentChunks(searchTerms: string[]): Promise<DocumentChunkResult[]> {
  const queries = searchTerms.filter(Boolean).map(
    (term) => {
      const sanitizedTerm = term.trim().replace(/[^\w\s]/g, '')
      return sql`
        SELECT document_chunks.*, document_chunks_fts.rank
        FROM document_chunks_fts
        JOIN document_chunks ON document_chunks_fts.id = document_chunks.id
        WHERE document_chunks_fts MATCH ${sanitizedTerm}
        ORDER BY rank DESC
        LIMIT 5
      `
    },
  )

  const results = await Promise.all(
    queries.map(async (query) => {
      const { results } = (await useDrizzle().run(query)) as { results: DocumentChunkResult[] }
      return results ?? []
    }),
  )

  return results
    .flat()
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, 10)
}

function performReciprocalRankFusion(
  fullTextResults: DocumentChunkResult[],
  vectorResults: VectorizeMatches[],
): { id: string, score: number }[] {
  const k = 60
  const scores: Record<string, number> = {}

  // Procesar resultados de búsqueda de texto completo
  fullTextResults.forEach((result, index) => {
    if (!result?.id) return
    const score = 1 / (k + index + 1)
    scores[result.id] = (scores[result.id] || 0) + score
  })

  // Procesar resultados de búsqueda vectorial
  vectorResults.forEach((result) => {
    result.matches?.forEach((match: VectorizeMatch, index: number) => {
      if (!match?.id) return
      const score = 1 / (k + index + 1)
      scores[match.id] = (scores[match.id] || 0) + score
    })
  })

  return Object.entries(scores)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}

async function queryVectorIndex(queries: string[], sessionId: string): Promise<VectorizeMatches[]> {
  const queryVectors = await Promise.all(
    queries.map(q => useAI().run('@cf/baai/bge-large-en-v1.5', { 
      model: '@cf/baai/bge-large-en-v1.5',
      text: [q] 
    }))
  )

  const allResults = await Promise.all(
    queryVectors.map(async (qv) => {
      const result = await useVectorize().query(
        (qv as { data: number[][] }).data[0], {
          topK: 5,
          returnValues: true,
          returnMetadata: 'all',
          namespace: 'default',
          filter: { sessionId },
        }
      )
      return result as VectorizeMatches
    })
  )

  return allResults
}

async function getRelevantDocuments(ids: string[]) {
  if (ids.length === 0) return []
  
  const relevantDocs = await useDrizzle()
    .select({ 
      id: documentChunks.id,
      text: documentChunks.text 
    })
    .from(documentChunks)
    .where(inArray(documentChunks.id, ids))

  return relevantDocs
}

export async function processUserQuery(
  { sessionId, messages }: { sessionId: string, messages: RoleScopedChatInput[] }, 
  streamResponse: (message: object) => Promise<void>
) {
  try {
    messages.unshift({ role: 'system', content: SYSTEM_MESSAGE })
    const lastMessage = messages[messages.length - 1]
    
    if (!lastMessage?.content) {
      throw new Error('No content in last message')
    }
    
    const query = lastMessage.content

    await streamResponse({ message: 'Rewriting message to queries...' })
    const queries = await rewriteToQueries(query)
    
    await streamResponse({ 
      message: 'Querying vector index and full text search...',
      queries,
    })

    const [fullTextSearchResults, vectorIndexResults] = await Promise.all([
      searchDocumentChunks(queries),
      queryVectorIndex(queries, sessionId),
    ])

    const mergedResults = performReciprocalRankFusion(
      fullTextSearchResults, 
      vectorIndexResults
    ).sort((a, b) => b.score - a.score)

    const topIds = mergedResults.slice(0, 10).map(r => r.id)
    const relevantDocs = await getRelevantDocuments(topIds)

    const relevantTexts = relevantDocs
      .map((doc, index) => `[${index + 1}]: ${doc.text}`)
      .join('\n\n')

    await streamResponse({
      message: 'Found relevant documents, generating response...',
      relevantContext: relevantDocs,
      queries,
    })

    messages.push({
      role: 'assistant',
      content: `The following queries were made:\n${queries.join('\n')}\n\nRelevant context from attached documents:\n${relevantTexts}`,
    })

    return { messages }
  } catch (error) {
    await streamResponse({
      error: `Error processing query: ${error instanceof Error ? error.message : 'Unknown error'}`
    })
    throw error
  }
}