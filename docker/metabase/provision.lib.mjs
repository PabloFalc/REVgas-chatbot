export const DATABASE_NAME = 'RevGás (leitura)';

export const COLLECTIONS = ['Gestor', 'Supervisor'];

const BRL = { number_style: 'currency', currency: 'BRL' };
const PERCENT = { suffix: '%' };
const SECONDS = { suffix: ' s', decimals: 1 };

function scalar(field, columnSettings) {
  const settings = { 'scalar.field': field };
  if (columnSettings) settings.column_settings = { [`["name","${field}"]`]: columnSettings };
  return { display: 'scalar', settings };
}

export const CARDS = [
  {
    name: 'gestor-vendas',
    sqlFile: 'gestor-vendas',
    collection: 'Gestor',
    ...scalar('pedidos_registrados'),
  },
  {
    name: 'gestor-vendas-valor',
    sqlFile: 'gestor-vendas',
    collection: 'Gestor',
    ...scalar('valor_registrado_brl', BRL),
  },
  {
    name: 'gestor-vendas-ticket',
    sqlFile: 'gestor-vendas',
    collection: 'Gestor',
    ...scalar('ticket_medio_brl', BRL),
  },
  {
    name: 'gestor-vendas-incertos',
    sqlFile: 'gestor-vendas',
    collection: 'Gestor',
    ...scalar('resultado_incerto'),
  },
  {
    name: 'gestor-conversao',
    sqlFile: 'gestor-conversao',
    collection: 'Gestor',
    ...scalar('conversao_madura_pct', PERCENT),
  },
  {
    name: 'gestor-conversao-total',
    sqlFile: 'gestor-conversao',
    collection: 'Gestor',
    ...scalar('conversao_total_pct', PERCENT),
  },
  {
    name: 'gestor-abandono',
    sqlFile: 'gestor-abandono',
    collection: 'Gestor',
    display: 'bar',
    settings: { 'graph.dimensions': ['ultima_etapa'], 'graph.metrics': ['ciclos_abandonados'] },
  },
  {
    name: 'supervisor-espera',
    sqlFile: 'supervisor-espera',
    collection: 'Supervisor',
    ...scalar('espera_p50_seg', SECONDS),
  },
  {
    name: 'supervisor-espera-p90',
    sqlFile: 'supervisor-espera',
    collection: 'Supervisor',
    ...scalar('espera_p90_seg', SECONDS),
  },
];

export const DASHBOARDS = [
  {
    name: 'Gestor',
    collection: 'Gestor',
    cards: [
      { card: 'gestor-vendas', title: 'Pedidos registrados', col: 0, row: 0, sizeX: 6, sizeY: 3 },
      {
        card: 'gestor-vendas-valor',
        title: 'Valor registrado',
        col: 6,
        row: 0,
        sizeX: 6,
        sizeY: 3,
      },
      { card: 'gestor-vendas-ticket', title: 'Ticket médio', col: 12, row: 0, sizeX: 6, sizeY: 3 },
      {
        card: 'gestor-vendas-incertos',
        title: 'Resultado incerto',
        col: 18,
        row: 0,
        sizeX: 6,
        sizeY: 3,
      },
      {
        card: 'gestor-conversao',
        title: 'Conversão madura (intenções com mais de 24 h)',
        col: 0,
        row: 3,
        sizeX: 12,
        sizeY: 3,
      },
      {
        card: 'gestor-conversao-total',
        title: 'Conversão total',
        col: 12,
        row: 3,
        sizeX: 12,
        sizeY: 3,
      },
      {
        card: 'gestor-abandono',
        title: 'Abandono por última etapa',
        col: 0,
        row: 6,
        sizeX: 24,
        sizeY: 8,
      },
    ],
  },
  {
    name: 'Supervisor',
    collection: 'Supervisor',
    cards: [
      {
        card: 'supervisor-espera',
        title: 'Espera até assumir (mediana)',
        col: 0,
        row: 0,
        sizeX: 12,
        sizeY: 3,
      },
      {
        card: 'supervisor-espera-p90',
        title: 'Espera até assumir (p90)',
        col: 12,
        row: 0,
        sizeX: 12,
        sizeY: 3,
      },
    ],
  },
];

const VARIABLES = {
  dias: {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Dias',
    sectionId: 'number',
    tagType: 'number',
    tagDefault: '30',
    parameterType: 'number/=',
    parameterDefault: 30,
  },
  incluir_simulados: {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Incluir simulados',
    sectionId: 'string',
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

export function buildCardPayload({
  name,
  sql,
  databaseId,
  collectionId,
  display = 'table',
  visualizationSettings = {},
}) {
  return {
    name,
    collection_id: collectionId,
    display,
    visualization_settings: visualizationSettings,
    dataset_query: {
      type: 'native',
      database: databaseId,
      native: { query: sql, 'template-tags': buildTemplateTags(sql) },
    },
    parameters: buildParameters(sql),
  };
}

function firstValue(value) {
  return String(Array.isArray(value) ? value[0] : value);
}

function summarizeCard(card, desiredSettings) {
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
    display: card.display,
    settings: Object.fromEntries(
      Object.keys(desiredSettings).map(key => [key, card.visualization_settings?.[key] ?? null]),
    ),
  };
}

export function planCard(existing, desired) {
  if (!existing) return 'create';
  const same =
    JSON.stringify(summarizeCard(existing, desired.visualization_settings)) ===
    JSON.stringify(summarizeCard(desired, desired.visualization_settings));
  return same ? 'unchanged' : 'update';
}

export function buildDashboardParameters() {
  return Object.entries(VARIABLES).map(([slug, definition]) => {
    const parameter = {
      id: definition.id,
      name: definition.displayName,
      slug,
      type: definition.parameterType,
      sectionId: definition.sectionId,
      default: definition.parameterDefault,
    };
    if (definition.values) {
      parameter.isMultiSelect = false;
      parameter.values_query_type = 'list';
      parameter.values_source_type = 'static-list';
      parameter.values_source_config = { values: definition.values };
    }
    return parameter;
  });
}

export function buildDashcardMappings(cardId, sql) {
  return extractTemplateTagNames(sql).map(name => ({
    card_id: cardId,
    parameter_id: definitionOf(name).id,
    target: ['variable', ['template-tag', name]],
  }));
}

export function buildDashboardPayload({ name, collectionId, cards }) {
  return {
    name,
    collection_id: collectionId,
    parameters: buildDashboardParameters(),
    dashcards: cards.map((card, index) => ({
      id: -(index + 1),
      card_id: card.cardId,
      col: card.col,
      row: card.row,
      size_x: card.sizeX,
      size_y: card.sizeY,
      parameter_mappings: buildDashcardMappings(card.cardId, card.sql),
      visualization_settings: card.title ? { 'card.title': card.title } : {},
    })),
  };
}

function summarizeDashboard(dashboard) {
  const parameters = (dashboard.parameters ?? [])
    .map(parameter => ({
      id: parameter.id,
      name: parameter.name,
      slug: parameter.slug,
      type: parameter.type,
      default: parameter.default === undefined ? null : parameter.default,
      values: parameter.values_source_config?.values ?? null,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const dashcards = (dashboard.dashcards ?? [])
    .map(dashcard => ({
      cardId: dashcard.card_id,
      col: dashcard.col,
      row: dashcard.row,
      sizeX: dashcard.size_x,
      sizeY: dashcard.size_y,
      title: dashcard.visualization_settings?.['card.title'] ?? null,
      mappings: (dashcard.parameter_mappings ?? [])
        .map(mapping => `${mapping.parameter_id}=${JSON.stringify(mapping.target)}`)
        .sort(),
    }))
    .sort((a, b) => a.cardId - b.cardId);
  return { name: dashboard.name, collectionId: dashboard.collection_id, parameters, dashcards };
}

export function planDashboard(existing, desired) {
  if (!existing) return 'create';
  const same =
    JSON.stringify(summarizeDashboard(existing)) === JSON.stringify(summarizeDashboard(desired));
  return same ? 'unchanged' : 'update';
}

export function reuseDashcardIds(existing, desired) {
  const byCard = new Map(
    (existing?.dashcards ?? []).map(dashcard => [dashcard.card_id, dashcard.id]),
  );
  return {
    ...desired,
    dashcards: desired.dashcards.map(dashcard => ({
      ...dashcard,
      id: byCard.get(dashcard.card_id) ?? dashcard.id,
    })),
  };
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
