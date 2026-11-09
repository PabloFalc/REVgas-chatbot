import { describe, expect, it } from 'vitest';
import { chunkDocument, chunkDocuments } from './chunker';

const doc = (markdown: string, source = 'base.md') => ({ source, markdown });

describe('chunkDocument', () => {
  it('cada ## vira um trecho com o título da seção', () => {
    const chunks = chunkDocument(
      doc('# Revenda\n\n## Bairros\nJóquei e Fátima.\n\n## Prazo\nAté 40 minutos.'),
    );
    expect(chunks.map(c => c.title)).toEqual(['Bairros', 'Prazo']);
    expect(chunks[0].content).toBe('Jóquei e Fátima.');
    expect(chunks[0].key).toBe('base.md#bairros');
    expect(chunks[1].key).toBe('base.md#prazo');
  });

  it('embeddingText leva título do documento e da seção', () => {
    const [chunk] = chunkDocument(doc('# Revenda\n\n## Bairros\nJóquei e Fátima.'));
    expect(chunk.embeddingText).toBe('Revenda — Bairros\n\nJóquei e Fátima.');
  });

  it('searchText sem acento e minúsculo', () => {
    const [chunk] = chunkDocument(doc('# Revenda\n\n## Bairros\nJóquei e Fátima.'));
    expect(chunk.searchText).toBe('bairros joquei e fatima.');
  });

  it('sem # usa o nome do arquivo como título do documento', () => {
    const [chunk] = chunkDocument(doc('## Prazo\nAté 40 minutos.', 'sub/entrega.md'));
    expect(chunk.embeddingText).toBe('entrega — Prazo\n\nAté 40 minutos.');
  });

  it('texto antes do primeiro ## vira trecho com o título do documento', () => {
    const chunks = chunkDocument(doc('# Revenda\n\nLoja fictícia.\n\n## Prazo\nAté 40 minutos.'));
    expect(chunks.map(c => c.title)).toEqual(['Revenda', 'Prazo']);
    expect(chunks[0].content).toBe('Loja fictícia.');
    expect(chunks[0].key).toBe('base.md#revenda');
  });

  it('seção vazia é ignorada', () => {
    const chunks = chunkDocument(doc('# Revenda\n\n## Vazia\n\n## Prazo\nAté 40 minutos.'));
    expect(chunks.map(c => c.title)).toEqual(['Prazo']);
  });

  it('### fica dentro da seção', () => {
    const chunks = chunkDocument(doc('# R\n\n## Botijões\n### P13\nCozinha.\n### P45\nComércio.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('### P13\nCozinha.\n### P45\nComércio.');
  });

  it('seção longa quebra em parágrafos', () => {
    const paragraphs = ['a', 'b', 'c'].map(letter => letter.repeat(500));
    const chunks = chunkDocument(doc(`# R\n\n## Prazo\n${paragraphs.join('\n\n')}`));
    expect(chunks.map(c => c.title)).toEqual(['Prazo', 'Prazo (parte 2)']);
    expect(chunks.map(c => c.key)).toEqual(['base.md#prazo', 'base.md#prazo-2']);
    expect(chunks[0].content).toBe(`${paragraphs[0]}\n\n${paragraphs[1]}`);
    expect(chunks[1].content).toBe(paragraphs[2]);
  });

  it('título repetido no mesmo arquivo ganha sufixo', () => {
    const chunks = chunkDocument(doc('# R\n\n## Troca\nUma.\n\n## Troca\nOutra.'));
    expect(chunks.map(c => c.key)).toEqual(['base.md#troca', 'base.md#troca-2']);
  });

  it('CRLF e LF dão os mesmos trechos e o mesmo hash', () => {
    const lf = '# R\n\n## Prazo\nAté 40 minutos.\n\n## Troca\nEm 7 dias.';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(chunkDocument(doc(crlf))).toEqual(chunkDocument(doc(lf)));
  });

  it('hash muda quando o conteúdo muda e é estável entre chamadas', () => {
    const [a] = chunkDocument(doc('# R\n\n## Prazo\nAté 40 minutos.'));
    const [again] = chunkDocument(doc('# R\n\n## Prazo\nAté 40 minutos.'));
    const [b] = chunkDocument(doc('# R\n\n## Prazo\nAté 50 minutos.'));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(again.hash).toBe(a.hash);
    expect(b.hash).not.toBe(a.hash);
  });
});

describe('chunkDocuments', () => {
  it('junta os trechos de vários documentos com chaves únicas', () => {
    const chunks = chunkDocuments([doc('## Prazo\nUm.', 'a.md'), doc('## Prazo\nDois.', 'b.md')]);
    expect(chunks.map(c => c.key)).toEqual(['a.md#prazo', 'b.md#prazo']);
  });
});
