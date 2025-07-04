import { computed } from 'vue'
import { useSessionId } from '~/composables/state'
import type { ExampleDocument } from '~/types'

export const useExampleSessions = (): ExampleDocument[] => [
  {
    id: '3aa8c534-2d63-4221-bde2-0e3e2b39cfd9',
    name: 'Cloudflare-Inc-NET-US-Q2-2024-Earnings-Call-1-August-2024-5_00-PM-ET.pdf',
    size: 0.311,
    chunks: 226,
    questions: [
      'What was the revenue growth rate in Q2?',
      'What are the example questions that the document answers?',
      'What were the key performance indicators for the quarter?',
      'What are the key outcomes from this call?',
    ]
  }
]

export const useIsExampleSession = () => {
  const exampleSessions = useExampleSessions()
  const sessionId = useSessionId()
  
  return computed(() => {
    return exampleSessions.some((doc: ExampleDocument) => doc.id === sessionId.value)
  })
}