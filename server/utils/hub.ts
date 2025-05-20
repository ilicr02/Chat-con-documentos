// server/utils/hub.ts
import { drizzle } from 'drizzle-orm/d1'
import { createClient } from '@supabase/supabase-js'
import type { D1Database, VectorizeIndex } from '@cloudflare/workers-types'
import * as schema from '../database/schema'

interface AIInterface {
  run: (model: string, options: any) => Promise<any>
}

// Tipos para los bindings de Cloudflare
interface CloudflareEnv {
  DB: D1Database
  VECTORIZE: VectorizeIndex
  AI: AIInterface
}

// Configuración de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth: { persistSession: false },
  },
)

// Singleton para el contexto
let _hubContext: CloudflareEnv | null = null

export function initializeHubContext(env: CloudflareEnv) {
  _hubContext = env
}

export function useHubContext(): CloudflareEnv {
  if (!_hubContext) {
    throw new Error('Hub context not initialized. Call initializeHubContext first.')
  }
  return _hubContext
}

export function useDrizzle() {
  const { DB } = useHubContext()
  return drizzle(DB, { schema })
}

export function useVectorize(): VectorizeIndex {
  const { VECTORIZE } = useHubContext()
  return VECTORIZE
}

interface AIOptions {
  model: string
  stream?: boolean
  [key: string]: unknown
}

export function useAI() {
  const { AI } = useHubContext()

  return {
    run: async <T = unknown>(model: string, options: AIOptions): Promise<T> => {
      return AI.run(model, options) as Promise<T>
    },

    generateEmbeddings: async (texts: string[]): Promise<{ data: number[][] }> => {
      const result = await AI.run('@cf/baai/bge-base-en-v1.5', {
        text: texts,
      })
      return { data: result.data as number[][] }
    },
  }
}

// Operaciones con Supabase Storage
export async function storePDF(
  file: File,
  path: string,
): Promise<{ publicUrl: string, storagePath: string }> {
  const { data, error } = await supabase.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET!)
    .upload(path, file)

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`)
  }

  const { data: { publicUrl } } = supabase.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET!)
    .getPublicUrl(data.path)

  return {
    publicUrl,
    storagePath: data.path,
  }
}

// Tipos útiles
export type DrizzleClient = ReturnType<typeof useDrizzle>
export type VectorizeClient = VectorizeIndex
export type AIClient = ReturnType<typeof useAI>