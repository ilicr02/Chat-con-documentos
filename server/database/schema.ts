// server/database/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  textContent: text('text_content'),
  size: integer('size').notNull(),
  sessionId: text('session_id'),
  storagePath: text('storage_path').notNull(),
  publicUrl: text('public_url').notNull(),
  status: text('status').default('uploaded'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const documentChunks = sqliteTable('document_chunks', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  text: text('text').notNull(),
  sessionId: text('session_id'),
  embeddingId: text('embedding_id'),
})

export type Document = typeof documents.$inferSelect
export type DocumentChunk = typeof documentChunks.$inferSelect
