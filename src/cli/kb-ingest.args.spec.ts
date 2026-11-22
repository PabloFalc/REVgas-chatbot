import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { formatCliError, parseIngestArgs } from './kb-ingest.args';

describe('parseIngestArgs', () => {
  it('sem argumentos usa a pasta padrão e sem force', () => {
    expect(parseIngestArgs([])).toEqual({ dir: undefined, force: false });
  });

  it('a pasta é o primeiro argumento que não é flag', () => {
    expect(parseIngestArgs(['minha/base'])).toEqual({ dir: 'minha/base', force: false });
  });

  it.each([[['--force', 'minha/base']], [['minha/base', '--force']]])(
    'aceita --force em qualquer posição: %j',
    argv => {
      expect(parseIngestArgs(argv)).toEqual({ dir: 'minha/base', force: true });
    },
  );

  it('só --force usa a pasta padrão', () => {
    expect(parseIngestArgs(['--force'])).toEqual({ dir: undefined, force: true });
  });
});

describe('formatCliError', () => {
  it('erro de consulta do Drizzle não mostra a query nem os parâmetros', () => {
    const cause = Object.assign(new Error('relation "knowledge_chunks" does not exist'), {
      name: 'DatabaseError',
      code: '42P01',
    });
    const error = new DrizzleQueryError(
      'select "chunk_key" from "knowledge_chunks" where "content" = $1',
      ['segredo'],
      cause,
    );
    const output = formatCliError(error);
    expect(output).toBe('Falha na consulta ao banco (DatabaseError 42P01)');
    expect(output).not.toMatch(/select|segredo|knowledge_chunks/);
  });

  it('erro de consulta sem causa conhecida mostra só o aviso', () => {
    const error = new DrizzleQueryError('select 1', [], new Error('connect ECONNREFUSED'));
    expect(formatCliError(error)).toBe('Falha na consulta ao banco (Error)');
  });

  it('mensagem que começa com "Failed query:" também esconde a query', () => {
    const error = new Error('Failed query: select 1\nparams: 123.456.789-09');
    expect(formatCliError(error)).toBe('Falha na consulta ao banco (Error)');
  });

  it('mensagem com várias linhas mostra só a primeira', () => {
    expect(formatCliError(new Error('Base indexada com outro modelo.\ndetalhe'))).toBe(
      'Base indexada com outro modelo.',
    );
  });

  it('mensagem vazia mostra o nome do erro', () => {
    const error = new TypeError('');
    expect(formatCliError(error)).toBe('TypeError');
  });

  it('valor que não é Error vira texto, também só a primeira linha', () => {
    expect(formatCliError('falhou\nsegredo')).toBe('falhou');
  });
});
