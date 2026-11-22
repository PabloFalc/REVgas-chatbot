CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"chunk_key" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"search_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunks_chunk_key_unique" UNIQUE("chunk_key")
);
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING gin (to_tsvector('portuguese', "search_text"));--> statement-breakpoint
CREATE INDEX "knowledge_chunks_model_idx" ON "knowledge_chunks" USING btree ("embedding_model");