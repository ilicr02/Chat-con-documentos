import { defineEventHandler, createError } from 'h3'
import type { H3Error } from 'h3'

export default defineEventHandler(async (event) => {
  // Verificar disponibilidad de servicios con tipado fuerte
  if (!event.context.hub?.vectorize) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Vectorize service not initialized',
    })
  }

  try {
    const vectorize = event.context.hub.vectorize('documents')

    // Insertar datos de prueba con metadata completa y tipado
    await vectorize.insert([{
      id: 'test-1',
      values: new Array(1024).fill(0.5),
      metadata: {
        test: true,
        sessionId: 'test-session',
        documentId: 'test-doc',
      },
    }])

    // Consulta vectorial con parámetros tipados
    const results = await vectorize.query(
      new Array(1024).fill(0.5),
      {
        topK: 1,
        returnMetadata: true,
        filter: { sessionId: 'test-session' },
      },
    )

    return {
      success: true,
      results,
    }
  }
  catch (err) {
    // Manejo seguro del error con type guard
    const error = err as Error | H3Error

    throw createError({
      statusCode: 500,
      statusMessage: 'Vectorize operation failed',
      // Mensaje seguro con comprobación de tipo
      message: error.message || 'Unknown error occurred',
      // Stack opcional para desarrollo usando import.meta.dev
      stack: import.meta.dev ? error.stack : undefined,
    })
  }
})
