export const DATABASE_NAME = 'RevGás (leitura)';

export const COLLECTIONS = ['Gestor', 'Supervisor'];

export const CARDS = [
  { name: 'gestor-vendas', collection: 'Gestor' },
  { name: 'gestor-conversao', collection: 'Gestor' },
  { name: 'gestor-abandono', collection: 'Gestor' },
  { name: 'supervisor-espera', collection: 'Supervisor' },
];

const VARIABLES = {
  dias: {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Dias',
    tagType: 'number',
    tagDefault: '30',
    parameterType: 'number/=',
    parameterDefault: 30,
  },
  incluir_simulados: {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Incluir simulados',
    tagType: 'text',
    tagDefault: 'nao',
    parameterType: 'string/=',
    parameterDefault: ['nao'],
    values: ['nao', 'sim'],
  },
};

export function extractTemplateTagNames(sql) {
  const names = [];
  for (const match of sql.matchAll(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

function definitionOf(name) {
  const definition = VARIABLES[name];
  if (!definition) {
    throw new Error(`O SQL usa a variável "${name}", que o provisionamento não conhece.`);
  }
  return definition;
}

export function buildTemplateTags(sql) {
  const tags = {};
  for (const name of extractTemplateTagNames(sql)) {
    const definition = definitionOf(name);
    tags[name] = {
      id: definition.id,
      name,
      'display-name': definition.displayName,
      type: definition.tagType,
      required: true,
      default: definition.tagDefault,
    };
  }
  return tags;
}

export function buildParameters(sql) {
  return extractTemplateTagNames(sql).map(name => {
    const definition = definitionOf(name);
    const parameter = {
      id: definition.id,
      type: definition.parameterType,
      target: ['variable', ['template-tag', name]],
      name: definition.displayName,
      slug: name,
      required: true,
      default: definition.parameterDefault,
    };
    if (definition.values) {
      parameter.values_query_type = 'list';
      parameter.values_source_type = 'static-list';
      parameter.values_source_config = { values: definition.values };
    }
    return parameter;
  });
}

export function buildCardPayload({ name, sql, databaseId, collectionId }) {
  return {
    name,
    collection_id: collectionId,
    display: 'table',
    visualization_settings: {},
    dataset_query: {
      type: 'native',
      database: databaseId,
      native: { query: sql, 'template-tags': buildTemplateTags(sql) },
    },
    parameters: buildParameters(sql),
  };
}

export function buildCardUpdate(payload) {
  const { display, visualization_settings, ...update } = payload;
  return update;
}

function firstValue(value) {
  return String(Array.isArray(value) ? value[0] : value);
}

function summarizeCard(card) {
  const query = card.dataset_query;
  const stage = query.stages?.[0];
  const sql = stage ? stage.native : query.native.query;
  const rawTags = stage ? stage['template-tags'] : query.native['template-tags'];
  const tags = (Array.isArray(rawTags) ? rawTags : Object.values(rawTags ?? {}))
    .map(tag => ({
      name: tag.name,
      type: tag.type,
      required: Boolean(tag.required),
      default: tag.default === undefined ? null : firstValue(tag.default),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parameters = (card.parameters ?? [])
    .map(parameter => ({
      slug: parameter.slug,
      type: parameter.type,
      required: Boolean(parameter.required),
      default: parameter.default === undefined ? null : firstValue(parameter.default),
      source: parameter.values_source_type ?? null,
      values: parameter.values_source_config?.values ?? null,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    name: card.name,
    collectionId: card.collection_id,
    databaseId: query.database,
    sql: String(sql).trim(),
    tags,
    parameters,
  };
}

export function planCard(existing, desired) {
  if (!existing) return 'create';
  const same = JSON.stringify(summarizeCard(existing)) === JSON.stringify(summarizeCard(desired));
  return same ? 'unchanged' : 'update';
}

export function buildDatabasePayload(config) {
  return {
    name: DATABASE_NAME,
    engine: 'postgres',
    details: {
      host: config.readerHost,
      port: config.readerPort,
      dbname: config.readerName,
      user: config.readerUser,
      password: config.readerPassword,
      ssl: false,
    },
    is_full_sync: true,
    auto_run_queries: true,
  };
}

export function planDatabase(existing, desired, forcePassword) {
  if (!existing) return 'create';
  if (forcePassword) return 'update';
  const { password, ...wanted } = desired.details;
  const current = existing.details ?? {};
  const same = Object.keys(wanted).every(key => current[key] === wanted[key]);
  return same ? 'unchanged' : 'update';
}

export function findByName(items, name) {
  return items.find(item => item.name === name);
}

export function loadConfig(env) {
  const missing = [];
  const need = name => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value;
  };
  const readerPassword = need('METABASE_READER_PASSWORD');
  const apiKey = env.METABASE_API_KEY?.trim() || undefined;
  let adminEmail;
  let adminPassword;
  if (apiKey) {
    adminEmail = env.METABASE_ADMIN_EMAIL?.trim() || undefined;
    adminPassword = env.METABASE_ADMIN_PASSWORD?.trim() || undefined;
  } else {
    adminEmail = need('METABASE_ADMIN_EMAIL');
    adminPassword = need('METABASE_ADMIN_PASSWORD');
  }
  if (missing.length > 0) {
    throw new Error(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}. ` +
        'Sem METABASE_API_KEY, informe METABASE_ADMIN_EMAIL e METABASE_ADMIN_PASSWORD.',
    );
  }
  const port = Number(env.METABASE_READER_PORT?.trim() || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('METABASE_READER_PORT deve ser um inteiro entre 1 e 65535.');
  }
  return {
    url: (env.METABASE_URL?.trim() || 'http://127.0.0.1:3001').replace(/\/+$/, ''),
    apiKey,
    adminEmail,
    adminPassword,
    readerHost: env.METABASE_READER_HOST?.trim() || 'postgres',
    readerPort: port,
    readerName: env.METABASE_READER_NAME?.trim() || 'revgas',
    readerUser: env.METABASE_READER_USER?.trim() || 'metrics_reader',
    readerPassword,
  };
}

export function redact(text, secrets) {
  let result = String(text);
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('***');
  }
  return result;
}
