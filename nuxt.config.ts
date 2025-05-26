import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: [
    '@nuxthub/core',
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxtjs/mdc',
    '@vueuse/nuxt',
    'nuxthub-ratelimit',
    '@nuxtjs/supabase',
  ],

  devtools: { enabled: true },

  runtimeConfig: {
    // Supabase
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY,
    supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET || 'documentos-con-pdf',

    // Cloudflare Hub
    cloudflare: {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      d1: {
        binding: 'DB',
        databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
      },
      vectorize: {
        binding: 'VECTORIZE',
        indexName: process.env.VECTORIZE_INDEX_NAME || 'document-vectors',
      },
    },

    public: {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
      supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET || 'documentos-con-pdf',
    },
  },

  future: { compatibilityVersion: 4 },
  compatibilityDate: '2024-07-30',

  nitro: {
    experimental: {
      openAPI: true,
    },
    esbuild: {
      supportedExtensions: ['.ts', '.js', '.mjs'],
    },
    devProxy: {
      '/.nuxt/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },

  hub: {
    ai: true,
    blob: false, // Desactivado porque usamos Supabase
    cache: true,
    database: true,
    kv: true,
    vectorize: {
      documents: {
        dimensions: 1024,
        metric: 'cosine',
        metadataIndexes: {
          sessionId: 'string',
          documentId: 'string',
        },
      },
    },
  },

  vite: {
    resolve: {
      alias: {
        '~/server': fileURLToPath(new URL('./server', import.meta.url)),
      },
    },
    server: {
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 3000,
      },
    },
  },

  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    d1DatabaseId: {
      db: {
        binding: 'DB',
        databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
      },
    },
  },

  eslint: {
    config: {
      stylistic: {
        quotes: 'single',
        semi: false,
      },
    },
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
    redirect: false,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    clientOptions: {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      db: {
        schema: 'public',
      },
    },
    cookies: {
      name: 'sb',
      lifetime: 60 * 60 * 8,
    },
  },
})
