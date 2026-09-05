-- Vectors now live in Qdrant (qdrant/qdrant v1.19.1, collection `axon_vectors`,
-- point id = Vector.id). Remove the pgvector column and extension from Postgres.
ALTER TABLE "Vector" DROP COLUMN IF EXISTS "embedding";

DROP EXTENSION IF EXISTS "vector";