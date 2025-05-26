-- En 0000_omniscient_lightspeed.sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  text_content TEXT,
  size INTEGER NOT NULL,
  session_id TEXT,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  status TEXT DEFAULT 'uploaded',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  text TEXT NOT NULL,
  session_id TEXT,
  embedding_id TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
  id UNINDEXED,
  document_id UNINDEXED,
  text,
  session_id UNINDEXED,
  content = 'document_chunks'
);

CREATE TRIGGER document_chunks_ai
AFTER INSERT ON document_chunks
BEGIN
  INSERT INTO document_chunks_fts(id, document_id, text, session_id)
  VALUES (new.id, new.document_id, new.text, new.session_id);
END;