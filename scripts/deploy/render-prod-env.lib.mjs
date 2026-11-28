import { randomBytes } from 'node:crypto';

const CATEGORY_LINE = /^#\s*(GERADA|ORIGEM|FIXA)(?:\s+(longa|senha|opcional))?\s*$/;
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const UNSAFE_VALUE = /[$"'`\\\n\r]/;
const COMMENT_VALUE = / #/;
const REUSED_FIXED = new Set(['BOT_IMAGE_TAG']);

export function stripQuotes(raw) {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseAssignments(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = ASSIGNMENT.exec(line);
    if (match) values.set(match[1], stripQuotes(match[2]));
  }
  return values;
}

export function parseTemplate(text) {
  const entries = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    const category = CATEGORY_LINE.exec(line);
    if (category) {
      current = { category: category[1], flag: category[2] };
      continue;
    }
    const match = ASSIGNMENT.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    if (!current) throw new Error(`${match[1]} aparece antes de uma linha de categoria`);
    entries.push({
      key: match[1],
      category: current.category,
      flag: current.flag,
      value: stripQuotes(match[2]),
    });
  }
  return entries;
}

export function generateValue(flag, random = randomBytes) {
  if (flag === 'longa') return random(64).toString('hex');
  if (flag === 'senha') return `Rv_${random(16).toString('hex')}K9`;
  return random(24).toString('hex');
}

export function parseSets(args) {
  const sets = new Map();
  for (const arg of args) {
    const index = arg.indexOf('=');
    if (index < 1) throw new Error('--set exige CHAVE=valor');
    sets.set(arg.slice(0, index), arg.slice(index + 1));
  }
  return sets;
}

export function buildEnv({ template, source, existing = new Map(), sets = new Map(), random }) {
  const known = new Set(template.map(entry => entry.key));
  const unknown = [...sets.keys()].filter(key => !known.has(key));
  if (unknown.length > 0) throw new Error(`--set com chave desconhecida: ${unknown.join(', ')}`);

  const warnings = [];
  const entries = template.map(entry => {
    let value = '';
    let origin = entry.category;
    if (entry.category === 'GERADA') {
      const reused = existing.get(entry.key);
      value = reused || generateValue(entry.flag, random);
      origin = reused ? 'GERADA (reaproveitada)' : 'GERADA';
    } else if (entry.category === 'ORIGEM') {
      value = source.get(entry.key) ?? '';
    } else {
      const reused = REUSED_FIXED.has(entry.key) ? existing.get(entry.key) : undefined;
      value = reused || entry.value;
      if (reused) origin = 'FIXA (reaproveitada)';
    }
    if (sets.has(entry.key)) {
      value = sets.get(entry.key);
      origin = `${entry.category} (--set)`;
    }
    return { ...entry, value, origin };
  });

  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const embedding = byKey.get('EMBEDDING_API_KEY');
  const llm = byKey.get('LLM_API_KEY');
  if (embedding && llm && !embedding.value && llm.value) {
    embedding.value = llm.value;
    embedding.origin = 'ORIGEM (copiada de LLM_API_KEY)';
    warnings.push('EMBEDDING_API_KEY vazia: usando a chave de LLM_API_KEY');
  }

  const unsafe = entries.filter(entry => UNSAFE_VALUE.test(entry.value)).map(entry => entry.key);
  if (unsafe.length > 0) {
    throw new Error(
      `valor com caractere não permitido ($ aspas crase barra invertida ou quebra de linha): ${unsafe.join(', ')}`,
    );
  }

  const commented = entries
    .filter(entry => COMMENT_VALUE.test(entry.value))
    .map(entry => entry.key);
  if (commented.length > 0) {
    throw new Error(
      `valor com espaço seguido de # (o Dokploy grava sem aspas e o resto viraria comentário): ${commented.join(', ')}`,
    );
  }

  const missing = entries
    .filter(entry => entry.flag !== 'opcional' && entry.value === '')
    .map(entry => entry.key);
  return { entries, warnings, missing };
}

export function formatEnv(entries) {
  const lines = entries.map(({ key, value }) =>
    /[\s#;]/.test(value) ? `${key}="${value}"` : `${key}=${value}`,
  );
  return `${lines.join('\n')}\n`;
}

export function describeEntries(entries) {
  return entries.map(
    ({ key, value, origin }) => `${key}: ${value ? 'preenchida' : 'vazia'} [${origin}]`,
  );
}
