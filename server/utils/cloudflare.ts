import type { D1Database, VectorizeIndex, Ai, KVNamespace } from '@cloudflare/workers-types'
import { useRuntimeConfig } from '#imports'

declare global {
  // eslint-disable-next-line no-var
  var AI: Ai
  interface Window {
    [key: string]: D1Database | VectorizeIndex | KVNamespace | undefined
  }
}

interface CloudflareConfig {
  accountId: string
  apiToken: string
  d1: {
    binding: string
    databaseId: string
  }
  vectorize: {
    binding: string
    indexName: string
  }
}

export function useCloudflare() {
  const config = useRuntimeConfig()
  const cfConfig = config.cloudflare as CloudflareConfig

  if (!cfConfig) throw new Error('Cloudflare configuration not found')

  return {
    // Para D1
    database: (): D1Database => {
      const binding = cfConfig.d1.binding
      const db = globalThis[binding as keyof typeof globalThis] as D1Database | undefined
      if (!db) {
        throw new Error(`D1 binding '${binding}' not available`)
      }
      return db
    },

    // Para AI
    ai: (): Ai => {
      if (!globalThis.AI) {
        throw new Error('Cloudflare AI binding not available')
      }
      return globalThis.AI
    },

    // Para Vectorize
    vectorize: (): VectorizeIndex => {
      const binding = cfConfig.vectorize.binding
      const index = globalThis[binding as keyof typeof globalThis] as VectorizeIndex | undefined
      if (!index) {
        throw new Error(`Vectorize binding '${binding}' not available`)
      }
      return index
    },

    // Para KV (si lo necesitas)
    kv: (binding = 'KV'): KVNamespace => {
      const store = globalThis[binding as keyof typeof globalThis] as KVNamespace | undefined
      if (!store) {
        throw new Error(`KV binding '${binding}' not available`)
      }
      return store
    },
  }
}
