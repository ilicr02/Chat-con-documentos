import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  textContent: text('text_content'),
  size: integer('size'),
  sessionId: text('session_id'),
  storageUrl: text('storage_url').notNull(),
})

export const documentChunks = sqliteTable('document_chunks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  text: text('text'),
  sessionId: text('session_id'),
})
