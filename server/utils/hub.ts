// server/utils/hub.ts
import { createClient } from '@supabase/supabase-js'
import { useRuntimeConfig } from '#imports'

// Configuración de Supabase
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth: { persistSession: false },
    global: { headers: { 'Content-Type': 'application/json' } },
  },
)

// Operaciones con Supabase Storage
export async function storePDF(file: File, path: string, bucket = process.env.SUPABASE_STORAGE_BUCKET!) {
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

// Conexión a Cloudflare D1
export function hubDatabase() {
  const { cloudflare } = useRuntimeConfig()
  if (!cloudflare?.d1) throw new Error('Cloudflare D1 not configured')

  return {
    async execute(query: string, params?: any[]) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${cloudflare.d1.databaseId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            sql: query,
            params: params || []
          }),
        }
      )
      const result = await response.json()
      if (!result.success) {
        throw new Error(`D1 query failed: ${JSON.stringify(result.errors)}`)
      }
      return result.result
    },
    async prepare(query: string) {
      return {
        bind: (...params: any[]) => ({
          first: async <T>() => {
            const result = await this.execute(query, params)
            return result[0] as T
          },
        }),
      }
    },
  }
}

// Conexión a Cloudflare AI
export function useAI() {
  const { cloudflare } = useRuntimeConfig()
  if (!cloudflare?.ai) throw new Error('Cloudflare AI not configured')

  return {
    async run<T = unknown>(model: string, input: Record<string, unknown>): Promise<T> {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      )
      if (!response.ok) {
        throw new Error(`AI request failed: ${response.statusText}`)
      }
      return response.json()
    },
    async generateEmbeddings(texts: string[]): Promise<{ data: number[][] }> {
      const response = await this.run<{ result: { data: number[][] } }>(
        '@cf/baai/bge-base-en-v1.5',
        { text: texts },
      )
      return { data: response.result.data }
    },
  }
}

// Conexión a Cloudflare Vectorize
export function useVectorize() {
  const { cloudflare } = useRuntimeConfig()
  if (!cloudflare?.vectorize) throw new Error('Cloudflare Vectorize not configured')

  return {
    async query(vector: number[], options: {
      topK?: number
      returnValues?: boolean
      returnMetadata?: boolean
      filter?: Record<string, unknown>
    }) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/vectorize/indexes/${cloudflare.vectorize.indexName}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ vector, ...options }),
        },
      )
      return response.json()
    },
    async upsert(vectors: Array<{
      id: string
      values: number[]
      metadata?: Record<string, unknown>
    }>) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/vectorize/indexes/${cloudflare.vectorize.indexName}/upsert`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ vectors }),
        },
      )
      if (!response.ok) throw new Error('Vectorize upsert failed')
    },
  }
}

// Conexión a Cloudflare KV
export function hubKV() {
  const { cloudflare } = useRuntimeConfig()
  if (!cloudflare?.kv) throw new Error('Cloudflare KV not configured')
  return cloudflare.kv
}
