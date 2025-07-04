import { z } from 'zod'
import { ReadableStream } from 'stream/web'

const schema = z.object({
  messages: z.array(
    z.object({
      role: z.union([z.literal('system'), z.literal('user'), z.literal('assistant'), z.literal('tool')]),
      content: z.string(),
    }),
  ),
  sessionId: z.string(),
})

export default defineEventHandler(async (event) => {
  const { messages, sessionId } = await readValidatedBody(event, schema.parse)
  const eventStream = createEventStream(event)
  const streamResponse = (data: object) => eventStream.push(JSON.stringify(data))

  event.waitUntil((async () => {
    try {
      const params = await processUserQuery({ messages, sessionId }, streamResponse)
      const ai = hubAI() // Usar hubAI en lugar de useAI()

      const result = await ai.run<ReadableStream<Uint8Array>>('@cf/meta/llama-3.1-8b-instruct', {
        messages: params.messages,
        stream: true,
      })

      const reader = result.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunkString = new TextDecoder().decode(value).slice(5)
          await eventStream.push(chunkString)
        }
      }
      finally {
        reader.releaseLock()
      }
    }
    catch (error) {
      console.error(error)
      await streamResponse({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
    finally {
      await eventStream.close()
    }
  })())

  return eventStream.send()
})
