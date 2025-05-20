import { defineEventHandler } from 'h3'

export default defineEventHandler((event) => {
  const _db = event.context.cloudflare?.env.DB
  return { status: 'ok', db: _db }
})
