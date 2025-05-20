// composables/state.ts
import { useState } from '#imports'
import type { RoleScopedChatInput } from '@cloudflare/workers-types'
import type { Document } from '~/types' // Importar desde types

export const useSessionId = () => useState<string>('sessionId', () => crypto.randomUUID())

export const useDocuments = () => useState<Document[]>('documents', () => [])
export const useMessages = () => useState<RoleScopedChatInput[]>('messages', () => [])

export const useQueries = () => useState<string[]>('queries', () => [])
export const useRelevantContext = () => useState<{ isProvided: boolean, context: string[] }>('relevantContext', () => ({ isProvided: false, context: [] }))

export const useInformativeMessage = () => useState<string>('informativeMessage', () => '')