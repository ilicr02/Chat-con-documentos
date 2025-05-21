# Chat CON PDF 🗣️💬📄

Chat con PDF es una aplicación completa impulsada por inteligencia artificial que te permite hacer preguntas a documentos PDF.

La aplicación se ejecuta con renderizado del lado del servidor en el borde utilizando Cloudflare Pages.

Puedes implementarlo sin necesidad de configuración en tu cuenta de Cloudflare usando NuxtHub:

[![Implementar en NuxtHub](https://hub.nuxt.com/button.svg)](https://hub.nuxt.com/new?template=chat-with-pdf)

### 🚀 Características clave

- **RAG híbrido** : RAG híbrido que utiliza búsqueda de texto completo en D1 y búsqueda vectorial en Vectorize
- **Respuestas transmitidas**: la información se transmite en tiempo real a la interfaz de usuario mediante eventos enviados por el servidor
- **Alto rendimiento**: implementación en el borde con renderizado del lado del servidor mediante páginas de Cloudflare

<!-- ### 🎥 Véalo en acción

https://github.com/Atinux/atidraw/assets/904724/85f79def-f633-40b7-97c2-3a8579e65af1

Ready to create? Visit [chat-with-pdf.nuxt.dev](https://chat-with-pdf.nuxt.dev) and share your best drawing! -->

## 🛠  Pila tecnológica

- [Nuxt](https://nuxt.com) - el marco intuitivo de Vue
- [Nuxt UI](https://github.com/nuxt/ui) -  una hermosa biblioteca de interfaz de usuario con TailwindCSS
- [Drizzle ORM](https://orm.drizzle.team/) - ORM de TypeScript moderno y potente
- [unpdf](https://github.com/unjs/unpdf) - versión independiente de la plataforma de [PDF.js](https://github.com/mozilla/pdf.js) para entornos sin servidor
- [NuxtHub Rate Limit](https://github.com/fayazara/nuxthub-ratelimit) - limitación de velocidad de solicitudes
- [NuxtHub](https://hub.nuxt.com) - crea e implementa en tu cuenta de Cloudflare sin necesidad de configuración
  - [`Supabase()`](https://supabase.com/) para almacenar archivos PDF en Supabase
  - [`hubDatabase()`](https://hub.nuxt.com/docs/features/blob) para almacenar fragmentos de documentos y realizar búsquedas de texto completo en Cloudflare D1
  - [`hubAI()`](https://hub.nuxt.com/docs/features/ai) Para ejecutar modelos de IA de Cloudflare para el chat LLM y generar incrustaciones de texto
  - [`hubVectorize()`](https://hub.nuxt.com/docs/features/ai) Para encontrar el contexto del documento relevante en Cloudflare Vectorize
  - [`hubKV()`](https://hub.nuxt.com/docs/features/ai) para limitar la velocidad de IP
- [`npx nuxthub deploy`](https://github.com/nuxt-hub/cli) - Para implementar la aplicación en su cuenta de Cloudflare de forma gratuita

## 🏎️ How does it work?

![Hybrid Search RAG](./.github/hybrid-rag.png)

This project uses a combination of classical Full Text Search (sparse) against Cloudflare D1 and Hybrid Search with embeddings against Vectorize (dense) to provide the best of both worlds providing the most applicable context to the LLM.

The way it works is this:

1. We take user input and we rewrite it to 5 different queries using an LLM
2. We run each of these queries against our both datastores - D1 database using BM25 for full-text search and Vectorize for dense retrieval
3. We take the results from both datastores and we merge them together using [Reciprocal Rank Fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html) which provides us with a single list of results
4. We then take the top 10 results from this list and we pass them to the LLM to generate a response

<sub>Creditos: https://github.com/RafalWilinski/cloudflare-rag#hybrid-search-rag</sub>

## 🚀 Inicio rápido

1. Instalar dependencias con [pnpm](https://pnpm.io)
    ```bash
    pnpm install
    ```
2. Cree y vincule un proyecto de NuxtHub para habilitar la ejecución de modelos de IA en su cuenta de Cloudflare
    ```bash
    npx nuxthub link
    ```
3. Implemente la aplicación en su cuenta de Cloudflare
    ```bash
    npx nuxthub deploy
    ```
4. Launch the dev server
    ```bash
    pnpm dev --remote
    ```

¡Visítanos http://localhost:3000y comienza a chatear con documentos!

## 🌐  Implementación en todo el mundo de forma gratuita

Aloje su instancia de Chat con PDF en una cuenta gratuita de Cloudflare y una cuenta gratuita de NuxtHub .

Implementarlo en línea en la interfaz de usuario de NuxtHub:

[![Deploy to NuxtHub](https://hub.nuxt.com/button.svg)](https://hub.nuxt.com/new?repo=RihanArfan/chat-with-pdf)

Integración con [Supabase](https://supabase.com/)  para Almacenamiento de PDFs

Esta aplicación utiliza Supabase para almacenar y gestionar documentos PDF de manera segura y escalable. A continuación, los pasos clave para configurarlo:

1. Configuración inicial de Supabase
Crea una cuenta en [Supabase](https://supabase.com/) y un nuevo proyecto.
-Ve a Storage → Buckets y crea un bucket
-Configura políticas de acceso en Authentication → Policies para permitir operaciones según tus necesidades

2. Variables de entorno
Agrega las credenciales de Supabase a tu proyecto en .env:

SUPABASE_URL=tu_url_de_supabase
SUPABASE_KEY=tu_clave_anon_o_service_role
SUPABASE_BUCKET=nombre_del_bucket

3. Subida de PDFs a Supabase
El proyecto utiliza el SDK de Supabase para cargar documentos. Ejemplo de código en Nuxt:
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function uploadPDF(file: File) {
  const { data, error } = await supabase
    .storage
    .from(process.env.SUPABASE_BUCKET)
    .upload(`pdfs/${file.name}`, file);

  if (error) throw error;
  return data.path; // Ruta del archivo en Supabase
}

5. Configuración en NuxtHub
Asegúrate de vincular Supabase en nuxt.config.ts.

6. Despliegue
Las variables de entorno (SUPABASE_*) deben agregarse en la configuración de tu proyecto en NuxtHub o Cloudflare Pages.

Verifica que los permisos del bucket en Supabase permitan operaciones desde tu dominio desplegado.

### Almacenamiento remoto

Una vez implementado tu proyecto, puedes usar [NuxtHub Remote Storage](https://hub.nuxt.com/docs/getting-started/remote-storage) para conectarte a tu bucket de vista previa o producción en desarrollo usando el `--remote` indicador:

```bash
pnpm dev --remote
```



## 🔗 Enlaces útiles

- [Demostración en vivo](https://chat-with-pdf.nuxt.dev)
- [Documentación de NuxtHub](https://hub.nuxt.com)
- [Interfaz de Usuario de Nuxt](https://ui.nuxt.com)
- [Nuxt](https://nuxt.com)

## 📝 Licencia

Publicado bajo la [MIT license](./LICENSE).


