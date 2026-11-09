export interface KnowledgeDocument {
  source: string;
  markdown: string;
}

export interface KnowledgeChunkDraft {
  key: string;
  source: string;
  title: string;
  content: string;
  embeddingText: string;
  searchText: string;
  hash: string;
}
