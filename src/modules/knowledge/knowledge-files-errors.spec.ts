import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockRejectedValue(Object.assign(new Error('negado'), { code: 'EACCES' })),
  readFile: vi.fn(),
}));

import { KnowledgeIngestError } from 'src/core/erros/knowledge.errors';
import { loadKnowledgeDocuments } from './knowledge-files';

describe('loadKnowledgeDocuments com erro de leitura', () => {
  it('repassa erros que não são de pasta ausente', async () => {
    const promise = loadKnowledgeDocuments('/qualquer');
    await expect(promise).rejects.toThrow('negado');
    await expect(promise).rejects.not.toBeInstanceOf(KnowledgeIngestError);
  });
});
