import { defineNuxtConfig } from 'nuxt/config'
import { fileURLToPath } from 'node:url'

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
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY,
    supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET || 'documentos-con-pdf',
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
    blob: true,
    cache: true,
    database: true,
    kv: true,
    vectorize: {
      documents: {
        dimensions: 1024,
        metric: 'euclidean',
        metadataIndexes: {
          sessionId: 'string',
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

  eslint: {
    config: {
      stylistic: {
        quotes: 'single',
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
    lifetime: 60 * 60 * 8, // 8 horas
  },
},
})
