import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeIngestError } from '../../core/erros/knowledge.errors';
import { FakeEmbeddingClient } from '../../integrations/llm/fake-embedding.client';
import type { IndexedChunk, KnowledgeDocument, StoredChunk } from './contracts/knowledge.types';
import { EmbeddingGateway } from './embedding.gateway';
import type { KnowledgeRepository } from './knowledge.repository';
import { KnowledgeIngestService } from './knowledge-ingest.service';

vi.mock('../../config/plugins/pino.config', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function doc(titles: string[]): KnowledgeDocument {
  return {
    source: 'geral.md',
    markdown: titles.map(t => `## ${t}\n\nTexto sobre ${t}.\n`).join('\n'),
  };
}

class MemoryRepository {
  rows = new Map<string, StoredChunk>();
  applyCalls: Array<{ upsert: StoredChunk[]; remove: string[] }> = [];

  async listIndex(): Promise<IndexedChunk[]> {
    return [...this.rows.values()].map(r => ({
      key: r.key,
      hash: r.hash,
      model: r.model,
      dimensions: r.dimensions,
    }));
  }

  async apply(changes: { upsert: StoredChunk[]; remove: string[] }): Promise<void> {
    this.applyCalls.push(changes);
    for (const key of changes.remove) this.rows.delete(key);
    for (const chunk of changes.upsert) this.rows.set(chunk.key, chunk);
  }
}

describe('KnowledgeIngestService', () => {
  let fake: FakeEmbeddingClient;
  let repo: MemoryRepository;
  let service: KnowledgeIngestService;

  function build(client = new FakeEmbeddingClient()) {
    fake = client;
    repo = new MemoryRepository();
    service = new KnowledgeIngestService(
      repo as unknown as KnowledgeRepository,
      new EmbeddingGateway(fake),
    );
  }

  beforeEach(() => build());

  it('primeira ingestão adiciona todos', async () => {
    const report = await service.ingest([doc(['Um', 'Dois', 'Tres'])]);
    expect(report).toEqual({ model: 'fake', added: 3, updated: 0, unchanged: 0, removed: 0 });
    expect(repo.rows.size).toBe(3);
  });

  it('rodar de novo sem mudança não chama o embedding', async () => {
    await service.ingest([doc(['Um', 'Dois', 'Tres'])]);
    fake.clear();
    const report = await service.ingest([doc(['Um', 'Dois', 'Tres'])]);
    expect(fake.calls).toEqual([]);
    expect(report).toMatchObject({ added: 0, updated: 0, unchanged: 3, removed: 0 });
  });

  it('seção alterada reprocessa só ela', async () => {
    await service.ingest([doc(['Um', 'Dois', 'Tres'])]);
    fake.clear();
    const changed = doc(['Um', 'Dois', 'Tres']);
    changed.markdown = changed.markdown.replace(
      'Texto sobre Dois.',
      'Outro texto totalmente novo.',
    );
    const report = await service.ingest([changed]);
    expect(report).toMatchObject({ added: 0, updated: 1, unchanged: 2, removed: 0 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].input).toHaveLength(1);
  });

  it('seção apagada é removida', async () => {
    await service.ingest([doc(['Um', 'Dois', 'Tres'])]);
    const report = await service.ingest([doc(['Um', 'Dois'])]);
    expect(report).toMatchObject({ added: 0, updated: 0, unchanged: 2, removed: 1 });
    expect(repo.rows.size).toBe(2);
  });

  it('modelo diferente do gravado reprocessa tudo', async () => {
    await service.ingest([doc(['Um', 'Dois', 'Tres'])]);
    for (const [key, row] of repo.rows) repo.rows.set(key, { ...row, model: 'outro' });
    const report = await service.ingest([doc(['Um', 'Dois', 'Tres'])]);
    expect(report).toMatchObject({ added: 0, updated: 3, unchanged: 0, removed: 0 });
  });

  it('dimensão do cliente diferente da tabela falha sem chamar embedding nem apply', async () => {
    build(new FakeEmbeddingClient({ dimensions: 1536 }));
    await expect(service.ingest([doc(['Um'])])).rejects.toThrow(KnowledgeIngestError);
    await expect(service.ingest([doc(['Um'])])).rejects.toThrow(/migration/);
    expect(fake.calls).toEqual([]);
    expect(repo.applyCalls).toEqual([]);
  });

  it('nenhum trecho falha e apply não é chamado', async () => {
    await expect(service.ingest([])).rejects.toThrow(KnowledgeIngestError);
    expect(fake.calls).toEqual([]);
    expect(repo.applyCalls).toEqual([]);
  });

  it('falha no embedding propaga e apply não é chamado', async () => {
    fake.queueError(new Error('boom') as never);
    await expect(service.ingest([doc(['Um'])])).rejects.toThrow('boom');
    expect(repo.applyCalls).toEqual([]);
  });

  it("manda os textos com operation 'kb-ingest' e timeout de 30 s", async () => {
    const spy = vi.spyOn(fake, 'embed');
    await service.ingest([doc(['Um', 'Dois'])]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ operation: 'kb-ingest', timeoutMs: 30_000 });
    expect(spy.mock.calls[0][0].input).toHaveLength(2);
  });

  it('sem mudanças não chama apply', async () => {
    await service.ingest([doc(['Um'])]);
    repo.applyCalls.length = 0;
    await service.ingest([doc(['Um'])]);
    expect(repo.applyCalls).toEqual([]);
  });
});
