-- BigBrain initial schema (see docs/ARCHITECTURE.md)
CREATE TABLE brains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  brain_id TEXT NOT NULL REFERENCES brains(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_url TEXT,
  source_type TEXT NOT NULL,
  mime_type TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  index_status TEXT NOT NULL DEFAULT 'pending',
  index_error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX documents_brain ON documents(brain_id);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  brain_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  timestamp TEXT
);
CREATE INDEX chunks_doc ON chunks(document_id);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  brain_id TEXT NOT NULL REFERENCES brains(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX conversations_brain ON conversations(brain_id, updated_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  citations TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX messages_conv ON messages(conversation_id, created_at);
