import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkDocuments } from './chunker';
import { loadKnowledgeDocuments } from './knowledge-files';

describe('base de conhecimento da revenda', () => {
  const load = async () =>
    chunkDocuments(await loadKnowledgeDocuments(resolve(process.cwd(), 'knowledge/base')));

  it('tem exatamente 13 trechos', async () => {
    expect(await load()).toHaveLength(13);
  });

  it('não tem horários', async () => {
    for (const chunk of await load()) {
      expect(chunk.content).not.toMatch(/\b\d{1,2}h\b|\b\d{1,2}:\d{2}\b/i);
    }
  });

  it("nenhum trecho tem 'R$', '%' ou 'reais'", async () => {
    for (const chunk of await load()) {
      expect(chunk.content).not.toMatch(/R\$|%|reais/i);
    }
  });

  it('menciona P13, P45 e vale-gás', async () => {
    const text = (await load()).map(c => c.content).join('\n');
    expect(text).toContain('P13');
    expect(text).toContain('P45');
    expect(text.toLowerCase()).toContain('vale-gás');
  });

  it('chaves únicas', async () => {
    const keys = (await load()).map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
