import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeIngestError } from 'src/core/erros/knowledge.errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadKnowledgeDocuments } from './knowledge-files';

describe('loadKnowledgeDocuments', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'knowledge-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lê os .md da pasta e subpastas, ordenados, e ignora outros arquivos', async () => {
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'b.md'), '## B\nbeta');
    await writeFile(join(dir, 'a.md'), '## A\nalfa');
    await writeFile(join(dir, 'x.json'), '{}');

    const docs = await loadKnowledgeDocuments(dir);

    expect(docs).toEqual([
      { source: 'a.md', markdown: '## A\nalfa' },
      { source: 'sub/b.md', markdown: '## B\nbeta' },
    ]);
  });

  it('pasta inexistente lança KnowledgeIngestError', async () => {
    const missing = join(dir, 'nao-existe');
    await expect(loadKnowledgeDocuments(missing)).rejects.toThrow(KnowledgeIngestError);
    await expect(loadKnowledgeDocuments(missing)).rejects.toThrow(
      `Pasta da base não encontrada: ${missing}`,
    );
  });
});
