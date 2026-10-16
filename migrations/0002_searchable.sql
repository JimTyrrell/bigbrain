-- Vectorize makes upserted vectors queryable 1-3 minutes after upsert() returns.
-- `searchable` flips to 1 once VECTORIZE.describe() reports processedUpToDatetime >= vector_written_at.
-- Default 1 so documents indexed before this migration stay searchable.
ALTER TABLE documents ADD COLUMN vector_written_at TEXT;
ALTER TABLE documents ADD COLUMN searchable INTEGER NOT NULL DEFAULT 1;
