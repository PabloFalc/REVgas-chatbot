import { resolve } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { DatabaseModule } from 'src/infra/database/database.module';
import { db } from 'src/infra/database/drizzle-client';
import { knowledgeChunks } from 'src/infra/database/schemas/knowledge/knowledge-chunks.table';
import { FakeEmbeddingClient } from 'src/integrations/llm/fake-embedding.client';
import { chunkDocuments } from 'src/modules/knowledge/chunker';
import type { StoredChunk } from 'src/modules/knowledge/contracts/knowledge.types';
import { KnowledgeRepository } from 'src/modules/knowledge/knowledge.repository';
import { loadKnowledgeDocuments } from 'src/modules/knowledge/knowledge-files';

const MODEL = 'fake-e2e';

describe('KnowledgeRepository (e2e)', () => {
  let moduleRef: TestingModule;
  let repository: KnowledgeRepository;
  const embedder = new FakeEmbeddingClient({ model: MODEL });
  let stored: StoredChunk[];

  const cleanup = () => db.delete(knowledgeChunks).where(eq(knowledgeChunks.embeddingModel, MODEL));
  const ownIndex = async () => (await repository.listIndex()).filter(item => item.model === MODEL);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [KnowledgeRepository],
    }).compile();
    repository = moduleRef.get(KnowledgeRepository);

    const drafts = chunkDocuments(
      await loadKnowledgeDocuments(resolve(process.cwd(), 'knowledge/base')),
    );
    stored = drafts.map(draft => ({
      key: `e2e/${draft.key}`,
      source: draft.source,
      title: draft.title,
      content: draft.content,
      searchText: draft.searchText,
      hash: draft.hash,
      model: MODEL,
      dimensions: embedder.dimensions,
      embedding: embedder.vectorFor(draft.embeddingText),
    }));
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await moduleRef.close();
  });

  it('apply grava e listIndex devolve chave, hash, modelo e dimensão', async () => {
    await repository.apply({ upsert: stored, remove: [] });

    const index = await ownIndex();
    expect(index).toHaveLength(stored.length);
    expect(index).toContainEqual({
      key: stored[0].key,
      hash: stored[0].hash,
      model: MODEL,
      dimensions: 768,
    });
  });

  it('apply com a mesma chave atualiza e não duplica; remove apaga', async () => {
    await repository.apply({ upsert: [{ ...stored[0], hash: 'novo-hash' }], remove: [] });
    let index = await ownIndex();
    expect(index).toHaveLength(stored.length);
    expect(index.find(item => item.key === stored[0].key)?.hash).toBe('novo-hash');

    await repository.apply({ upsert: [stored[0]], remove: [stored[1].key] });
    index = await ownIndex();
    expect(index).toHaveLength(stored.length - 1);
    expect(index.find(item => item.key === stored[1].key)).toBeUndefined();
    expect(index.find(item => item.key === stored[0].key)?.hash).toBe(stored[0].hash);

    await repository.apply({ upsert: [stored[1]], remove: [] });
  });

  it('apply vazio não faz nada', async () => {
    await expect(repository.apply({ upsert: [], remove: [] })).resolves.toBeUndefined();
  });

  it('findCandidates por vetor traz o trecho mais parecido primeiro e similarity entre 0 e 1', async () => {
    const { byVector } = await repository.findCandidates({
      embedding: embedder.vectorFor('Prazo de entrega'),
      question: 'oi, bom dia',
      model: MODEL,
      limit: 5,
    });

    expect(byVector).toHaveLength(5);
    expect(byVector[0].title).toBe('Prazo de entrega');
    for (const candidate of byVector) {
      expect(typeof candidate.similarity).toBe('number');
      expect(candidate.similarity).toBeGreaterThanOrEqual(0);
      expect(candidate.similarity).toBeLessThanOrEqual(1.0001);
    }
    expect(byVector[0].similarity).toBeGreaterThanOrEqual(byVector[1].similarity);
  });

  it('busca textual acha termo exato sem acento', async () => {
    const vale = await repository.findCandidates({
      embedding: embedder.vectorFor('vale gas'),
      question: 'vale gas',
      model: MODEL,
      limit: 5,
    });
    expect(vale.byText.map(c => c.title)).toContain('Vale-gás');

    const p45 = await repository.findCandidates({
      embedding: embedder.vectorFor('p45'),
      question: 'tem P-45?',
      model: MODEL,
      limit: 5,
    });
    expect(p45.byText.map(c => c.title)).toContain('Botijões P13 e P45');
    expect(typeof p45.byText[0].similarity).toBe('number');
  });

  it('pergunta sem termo útil não roda a busca textual', async () => {
    const { byText } = await repository.findCandidates({
      embedding: embedder.vectorFor('vale gas'),
      question: 'oi, bom dia?',
      model: MODEL,
      limit: 5,
    });
    expect(byText).toEqual([]);
  });

  it('trechos de outro modelo não aparecem', async () => {
    const { byVector, byText } = await repository.findCandidates({
      embedding: embedder.vectorFor('vale gas'),
      question: 'vale',
      model: 'fake-e2e-outro',
      limit: 5,
    });
    expect(byVector).toEqual([]);
    expect(byText).toEqual([]);
  });
  it('listTitles devolve os títulos do modelo, um por seção, e nada de outro modelo', async () => {
    const titles = await repository.listTitles(MODEL);
    expect(new Set(titles)).toEqual(new Set(stored.map(chunk => chunk.title)));
    expect(titles).toHaveLength(new Set(titles).size);
    await expect(repository.listTitles('fake-e2e-outro')).resolves.toEqual([]);
  });
});
