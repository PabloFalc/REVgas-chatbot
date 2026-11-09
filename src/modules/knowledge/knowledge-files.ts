import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { KnowledgeIngestError } from 'src/core/erros/knowledge.errors';
import type { KnowledgeDocument } from './contracts/knowledge.types';

export async function loadKnowledgeDocuments(dir: string): Promise<KnowledgeDocument[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    throw new KnowledgeIngestError(`Pasta da base não encontrada: ${dir}`);
  }

  const sources = entries
    .filter(entry => entry.toLowerCase().endsWith('.md'))
    .map(entry => entry.split(sep).join('/'))
    .sort();

  return Promise.all(
    sources.map(async source => ({
      source,
      markdown: await readFile(join(dir, source), 'utf8'),
    })),
  );
}
