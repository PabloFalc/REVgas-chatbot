import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { embedBlock, extractBlock } from './compose-sync.lib.mjs';
import { buildBody, filterEnv, normalizeApiBase, referencedVars } from './dokploy-push.lib.mjs';
import {
  buildEnv,
  formatEnv,
  generateValue,
  parseAssignments,
  parseSets,
  parseTemplate,
} from './render-prod-env.lib.mjs';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const TEMPLATE = `# GERADA
DB_PASS=
# GERADA longa
BIG=
# GERADA senha
HUMAN=
# ORIGEM
API_KEY=
LLM_API_KEY=
# ORIGEM opcional
EMBEDDING_API_KEY=
# FIXA
MODE=live
`;

const SOURCE = `anotações soltas
API_KEY=abc123
export LLM_API_KEY="llm-secret"
texto = qualquer coisa
OUTRA_CHAVE=ignorada
`;

describe('render-prod-env', () => {
  const template = parseTemplate(TEMPLATE);
  const fixed = () => Buffer.alloc(64, 1);

  it('separa categorias e extrai só as chaves de origem', () => {
    const { entries, missing } = buildEnv({
      template,
      source: parseAssignments(SOURCE),
      random: fixed,
    });
    const get = (key: string) => entries.find(entry => entry.key === key)?.value;
    expect(get('API_KEY')).toBe('abc123');
    expect(get('LLM_API_KEY')).toBe('llm-secret');
    expect(get('MODE')).toBe('live');
    expect(entries.find(entry => entry.key === 'OUTRA_CHAVE')).toBeUndefined();
    expect(missing).toEqual([]);
  });

  it('usa a chave do LLM quando a de embedding está vazia e avisa sem mostrar valor', () => {
    const { entries, warnings } = buildEnv({
      template,
      source: parseAssignments(SOURCE),
      random: fixed,
    });
    expect(entries.find(entry => entry.key === 'EMBEDDING_API_KEY')?.value).toBe('llm-secret');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('llm-secret');
  });

  it('gera hex, senha com complexidade e valores únicos', () => {
    expect(generateValue(undefined)).toMatch(/^[0-9a-f]{48}$/);
    expect(generateValue('longa')).toMatch(/^[0-9a-f]{128}$/);
    const password = generateValue('senha');
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/\d/);
    expect(password).toMatch(/_/);
    expect(generateValue(undefined)).not.toBe(generateValue(undefined));
  });

  it('reaproveita geradas do arquivo existente', () => {
    const first = buildEnv({ template, source: parseAssignments(SOURCE) });
    const existing = parseAssignments(formatEnv(first.entries));
    const second = buildEnv({ template, source: parseAssignments(SOURCE), existing });
    const pick = (result: typeof first) =>
      result.entries.filter(e => e.category === 'GERADA').map(e => e.value);
    expect(pick(second)).toEqual(pick(first));
  });

  it('lista as obrigatórias vazias e aceita --set', () => {
    const empty = buildEnv({ template, source: new Map() });
    expect(empty.missing).toEqual(['API_KEY', 'LLM_API_KEY']);
    const set = buildEnv({
      template,
      source: parseAssignments(SOURCE),
      sets: parseSets(['MODE=fake', 'DB_PASS=fixa']),
    });
    expect(set.entries.find(entry => entry.key === 'MODE')?.value).toBe('fake');
    expect(set.entries.find(entry => entry.key === 'DB_PASS')?.value).toBe('fixa');
  });

  it('recusa chave desconhecida e caractere perigoso', () => {
    expect(() => buildEnv({ template, source: new Map(), sets: parseSets(['X=1']) })).toThrow(
      /desconhecida/,
    );
    expect(() =>
      buildEnv({ template, source: new Map([['API_KEY', 'a$b']]), sets: new Map() }),
    ).toThrow(/API_KEY/);
  });

  it('o template de produção tem todas as variáveis do compose', () => {
    const keys = new Set(parseTemplate(read('docker/prod.env.example')).map(entry => entry.key));
    const used = referencedVars(read('docker/compose.prod.yaml'));
    const missing = [...used].filter(name => !keys.has(name));
    expect(missing).toEqual([]);
  });

  describe('CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('grava com permissão 600, não imprime valores e mantém as senhas na segunda execução', () => {
      const source = join(dir, 'fonte.txt');
      const out = join(dir, 'saida.env');
      writeFileSync(source, SOURCE);
      const run = () =>
        execFileSync(
          'node',
          [
            join(root, 'scripts/deploy/render-prod-env.mjs'),
            source,
            '--out',
            out,
            '--template',
            join(dir, 'modelo.env'),
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      writeFileSync(join(dir, 'modelo.env'), TEMPLATE);
      const stdout = run();
      expect(stdout).not.toContain('abc123');
      expect(stdout).toContain('API_KEY: preenchida');
      expect(statSync(out).mode & 0o777).toBe(0o600);
      const first = readFileSync(out, 'utf8');
      run();
      expect(readFileSync(out, 'utf8')).toBe(first);
    });
  });
});

describe('dokploy-push', () => {
  it('aceita DOKPLOY_URL com ou sem /api', () => {
    expect(normalizeApiBase('https://d.exemplo.com')).toBe('https://d.exemplo.com/api');
    expect(normalizeApiBase('https://d.exemplo.com/')).toBe('https://d.exemplo.com/api');
    expect(normalizeApiBase('https://d.exemplo.com/api')).toBe('https://d.exemplo.com/api');
  });

  it('envia só as chaves que o compose usa', () => {
    const vars = referencedVars('a: $\u007bA:?}\nb: $$B\nc: $\u007bC:-x}\n');
    expect([...vars]).toEqual(['A', 'C']);
    const { env, dropped } = filterEnv('A=1\nB=2\nC=3\nD=4\n', vars);
    expect(env).toBe('A=1\nC=3\n');
    expect(dropped).toEqual(['B', 'D']);
  });

  it('monta o corpo como fonte raw', () => {
    expect(buildBody({ composeId: 'id', composeFile: 'f', env: 'e' })).toEqual({
      composeId: 'id',
      composeFile: 'f',
      env: 'e',
      sourceType: 'raw',
    });
  });
});

describe('compose.prod.yaml', () => {
  const compose = read('docker/compose.prod.yaml');

  it('embute o setup.rb sem divergir', () => {
    expect(extractBlock(compose, 'chatwoot_setup')).toBe(read('docker/chatwoot/setup.rb'));
  });

  it('embedBlock é inverso de extractBlock', () => {
    const rb = 'a = 1\n\nb = 2\n';
    expect(extractBlock(embedBlock(compose, 'chatwoot_setup', rb), 'chatwoot_setup')).toBe(rb);
  });

  it('repete os grants do metrics-reader.sql', () => {
    const block = extractBlock(compose, 'metrics_reader_sql');
    const grants = read('docker/metabase/metrics-reader.sql')
      .split('\n')
      .filter(line => /^(GRANT|ALTER ROLE metrics_reader SET)/.test(line));
    expect(grants.length).toBeGreaterThan(3);
    for (const line of grants) expect(block).toContain(line);
  });
});
