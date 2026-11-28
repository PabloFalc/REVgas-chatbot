export const DATABASE_NAME = 'RevGás (leitura)';

export const COLLECTIONS = ['Gestor', 'Supervisor', 'Técnico'];

const SEPARATORS = ',.';
const BRL = {
  number_style: 'currency',
  currency: 'BRL',
  currency_style: 'symbol',
  decimals: 2,
  number_separators: SEPARATORS,
};
const PERCENT = { suffix: '%', decimals: 1, number_separators: SEPARATORS };
const SECONDS = { suffix: ' s', decimals: 1, number_separators: SEPARATORS };
const ORDINAL = 'graph.x_axis.scale';
const STACKED = 'stackable.stack_type';

const DATE_STYLE = { date_style: 'D/M/YYYY', date_separator: '/', date_abbreviate: false };
const DATETIME_STYLE = { ...DATE_STYLE, time_enabled: 'minutes', time_style: 'k:mm' };

export const TRANSLATIONS = {
  etapa: {
    askName: 'Nome do cliente',
    askCpf: 'CPF',
    askCpfPrefix: 'Início do CPF',
    confirmCpf: 'Confirmação do CPF',
    offerRepeat: 'Oferta de repetir o último pedido',
    chooseAddress: 'Escolha do endereço',
    askNewAddress: 'Novo endereço',
    askAddressField: 'Dados do endereço',
    confirmAddress: 'Confirmação do endereço',
    chooseProduct: 'Escolha do produto',
    searchProduct: 'Busca do produto',
    pickProduct: 'Seleção do produto',
    chooseQuantity: 'Escolha da quantidade',
    askQuantity: 'Quantidade',
    choosePayment: 'Escolha do pagamento',
    askNeedsChange: 'Pergunta sobre troco',
    askChangeAmount: 'Valor do troco',
    summary: 'Resumo do pedido',
    chooseCorrection: 'Correção do pedido',
    creatingSale: 'Registro da venda',
    saleFailed: 'Falha ao registrar a venda',
    unknown: 'Etapa não registrada',
  },
  motivoHandoff: {
    customer_request: 'Pedido do cliente',
    emergency: 'Emergência',
    sale_failed: 'Falha ao registrar a venda',
    sale_rejected: 'Venda recusada',
    sale_uncertain: 'Resultado da venda incerto',
    sale_cancellation: 'Cancelamento de venda',
    quantity_limit: 'Limite de quantidade',
    identity_failure: 'Falha na confirmação de identidade',
    stuck: 'Cliente sem avançar no pedido',
    offense: 'Ofensa do cliente',
    sem_motivo: 'Sem motivo registrado',
  },
  tipoHandoff: {
    handoff: 'Transferido para atendente',
    handoff_offered: 'Transferência oferecida',
  },
  finalidadeIa: {
    interpret: 'Interpretação da mensagem',
    read_name: 'Leitura do nome',
    address: 'Leitura do endereço',
    question: 'Pergunta do cliente',
    sem_motivo: 'Sem finalidade registrada',
  },
  resultadoRag: {
    answered: 'Pergunta respondida',
    no_match: 'Sem trecho parecido na base',
    not_in_sources: 'Assunto fora da base',
    rejected: 'Pergunta recusada',
    unavailable: 'Busca indisponível',
  },
};

export const VIEWS = {
  'gestor-vendas': {
    columns: [
      { from: 'pedidos_registrados', as: 'Pedidos registrados' },
      { from: 'valor_registrado_brl', as: 'Valor registrado (R$)' },
      { from: 'ticket_medio_brl', as: 'Ticket médio (R$)' },
      { from: 'resultado_incerto', as: 'Pedidos com resultado incerto' },
    ],
  },
  'gestor-conversao': {
    columns: [
      { from: 'intencoes_maduras', as: 'Intenções maduras' },
      { from: 'pedidos_em_intencoes_maduras', as: 'Pedidos nas intenções maduras' },
      { from: 'conversao_madura_pct', as: 'Conversão madura (%)' },
      { from: 'intencoes_totais', as: 'Intenções totais' },
      { from: 'pedidos_em_intencoes_totais', as: 'Pedidos nas intenções totais' },
      { from: 'conversao_total_pct', as: 'Conversão total (%)' },
    ],
  },
  'gestor-funil-diario': {
    columns: [
      { from: 'dia', as: 'Dia', format: 'date' },
      { from: 'ciclos', as: 'Compras iniciadas' },
      { from: 'resumos', as: 'Chegaram ao resumo' },
      { from: 'vendas', as: 'Vendas registradas' },
      { from: 'conversao_percentual', as: 'Conversão (%)' },
    ],
    orderBy: 'base.dia',
  },
  'gestor-abandono': {
    columns: [
      { from: 'ultima_etapa', as: 'Última etapa', translate: 'etapa' },
      { from: 'ciclos_abandonados', as: 'Compras abandonadas' },
    ],
    orderBy: 'base.ciclos_abandonados DESC',
  },
  'supervisor-espera': {
    columns: [
      { from: 'espera_p50_seg', as: 'Espera mediana (s)' },
      { from: 'espera_p90_seg', as: 'Espera em 90% dos casos (s)' },
      { from: 'handoffs_assumidos', as: 'Atendimentos assumidos' },
    ],
  },
  'supervisor-handoffs': {
    columns: [
      { from: 'motivo', as: 'Motivo', translate: 'motivoHandoff' },
      { from: 'tipo', as: 'Tipo', translate: 'tipoHandoff' },
      { from: 'eventos', as: 'Ocorrências' },
    ],
    orderBy: 'base.eventos DESC',
  },
  'tecnico-latencia': {
    columns: [
      { from: 'dia', as: 'Dia', format: 'date' },
      { from: 'p50_ms', as: 'Mediana (ms)' },
      { from: 'p95_ms', as: 'Percentil 95 (ms)' },
    ],
    orderBy: 'base.dia',
  },
  'tecnico-ia': {
    columns: [
      { from: 'hora', as: 'Hora', format: 'datetime' },
      { from: 'reason', as: 'Finalidade', translate: 'finalidadeIa' },
      { from: 'chamadas', as: 'Chamadas' },
      { from: 'permitidas', as: 'Permitidas' },
      { from: 'bloqueadas', as: 'Bloqueadas' },
      { from: 'unidades_consumidas', as: 'Unidades consumidas' },
    ],
    orderBy: 'base.hora, base.reason',
  },
  'tecnico-rag': {
    columns: [
      { from: 'dia', as: 'Dia', format: 'date' },
      { from: 'motivo', as: 'Resultado', translate: 'resultadoRag' },
      { from: 'desconhecidas', as: 'Sem resposta' },
      { from: 'chamadas', as: 'Chamadas' },
      { from: 'taxa_nao_sei_percentual', as: 'Taxa de "não sei" (%)' },
    ],
    orderBy: 'base.dia, base.motivo',
  },
};

function quoteText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteName(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function columnExpression({ from, as, translate }) {
  const source = `base.${from}`;
  const labels = translate ? TRANSLATIONS[translate] : undefined;
  if (!labels) return `${source} AS ${quoteName(as)}`;
  const whens = Object.entries(labels)
    .map(([value, label]) => `WHEN ${quoteText(value)} THEN ${quoteText(label)}`)
    .join(' ');
  return `CASE ${source} ${whens} ELSE ${source}::text END AS ${quoteName(as)}`;
}

export function wrapSql(sql, view) {
  const inner = String(sql)
    .trim()
    .replace(/;+\s*$/, '');
  const select = view.columns.map(columnExpression).join(',\n  ');
  const order = view.orderBy ? `\nORDER BY ${view.orderBy}` : '';
  return `WITH base AS (\n${inner}\n)\nSELECT\n  ${select}\nFROM base${order}`;
}

function label(sqlFile, from) {
  const column = VIEWS[sqlFile].columns.find(candidate => candidate.from === from);
  if (!column) throw new Error(`Coluna "${from}" não existe na visão de "${sqlFile}".`);
  return column.as;
}

function dateColumnSettings(sqlFile) {
  const entries = VIEWS[sqlFile].columns
    .filter(column => column.format)
    .map(column => [
      `["name","${column.as}"]`,
      column.format === 'datetime' ? DATETIME_STYLE : DATE_STYLE,
    ]);
  return Object.fromEntries(entries);
}

function scalar(sqlFile, from, columnSettings) {
  const field = label(sqlFile, from);
  const settings = { 'scalar.field': field };
  if (columnSettings) settings.column_settings = { [`["name","${field}"]`]: columnSettings };
  return { sqlFile, display: 'scalar', settings };
}

function chart(sqlFile, display, { dimensions, metrics, xTitle, yTitle, extra = {} }) {
  const settings = {
    'graph.dimensions': dimensions.map(from => label(sqlFile, from)),
    'graph.metrics': metrics.map(from => label(sqlFile, from)),
    'graph.x_axis.title_text': xTitle,
    'graph.y_axis.title_text': yTitle,
    ...extra,
  };
  const dates = dateColumnSettings(sqlFile);
  if (Object.keys(dates).length > 0) settings.column_settings = dates;
  return { sqlFile, display, settings };
}

export const CARDS = [
  {
    name: 'gestor-vendas',
    collection: 'Gestor',
    ...scalar('gestor-vendas', 'pedidos_registrados'),
  },
  {
    name: 'gestor-vendas-valor',
    collection: 'Gestor',
    ...scalar('gestor-vendas', 'valor_registrado_brl', BRL),
  },
  {
    name: 'gestor-vendas-ticket',
    collection: 'Gestor',
    ...scalar('gestor-vendas', 'ticket_medio_brl', BRL),
  },
  {
    name: 'gestor-vendas-incertos',
    collection: 'Gestor',
    ...scalar('gestor-vendas', 'resultado_incerto'),
  },
  {
    name: 'gestor-conversao',
    collection: 'Gestor',
    ...scalar('gestor-conversao', 'conversao_madura_pct', PERCENT),
  },
  {
    name: 'gestor-conversao-total',
    collection: 'Gestor',
    ...scalar('gestor-conversao', 'conversao_total_pct', PERCENT),
  },
  {
    name: 'gestor-funil-diario',
    collection: 'Gestor',
    ...chart('gestor-funil-diario', 'bar', {
      dimensions: ['dia'],
      metrics: ['ciclos', 'resumos', 'vendas'],
      xTitle: 'Dia',
      yTitle: 'Quantidade de compras',
      extra: { [ORDINAL]: 'ordinal' },
    }),
  },
  {
    name: 'gestor-abandono',
    collection: 'Gestor',
    ...chart('gestor-abandono', 'bar', {
      dimensions: ['ultima_etapa'],
      metrics: ['ciclos_abandonados'],
      xTitle: 'Última etapa',
      yTitle: 'Compras abandonadas',
    }),
  },
  {
    name: 'supervisor-espera',
    collection: 'Supervisor',
    ...scalar('supervisor-espera', 'espera_p50_seg', SECONDS),
  },
  {
    name: 'supervisor-espera-p90',
    collection: 'Supervisor',
    ...scalar('supervisor-espera', 'espera_p90_seg', SECONDS),
  },
  {
    name: 'supervisor-handoffs',
    collection: 'Supervisor',
    ...chart('supervisor-handoffs', 'bar', {
      dimensions: ['motivo', 'tipo'],
      metrics: ['eventos'],
      xTitle: 'Motivo',
      yTitle: 'Ocorrências',
      extra: { [STACKED]: 'stacked' },
    }),
  },
  {
    name: 'tecnico-latencia',
    collection: 'Técnico',
    ...chart('tecnico-latencia', 'line', {
      dimensions: ['dia'],
      metrics: ['p50_ms', 'p95_ms'],
      xTitle: 'Dia',
      yTitle: 'Tempo do turno (ms)',
      extra: { [ORDINAL]: 'ordinal' },
    }),
  },
  {
    name: 'tecnico-ia',
    collection: 'Técnico',
    ...chart('tecnico-ia', 'bar', {
      dimensions: ['hora', 'reason'],
      metrics: ['chamadas'],
      xTitle: 'Hora',
      yTitle: 'Chamadas de IA',
      extra: { [STACKED]: 'stacked' },
    }),
  },
  {
    name: 'tecnico-rag',
    collection: 'Técnico',
    ...chart('tecnico-rag', 'bar', {
      dimensions: ['dia', 'motivo'],
      metrics: ['chamadas'],
      xTitle: 'Dia',
      yTitle: 'Chamadas à base de conhecimento',
      extra: { [STACKED]: 'stacked', [ORDINAL]: 'ordinal' },
    }),
  },
];

const LEGEND_FOOTER = [
  'Os valores vêm do registro de pedidos do bot, não do financeiro, e podem divergir do caixa.',
  'Dados de teste (simulados) só aparecem com o filtro "Incluir dados simulados" em "sim".',
  'O filtro "Período (dias)" vale para todos os números e gráficos deste painel.',
];

function legend(title, lines, extraWarnings = []) {
  const items = lines.map(line => `- ${line}`).join('\n');
  const warnings = [...extraWarnings, ...LEGEND_FOOTER].map(line => `- ${line}`).join('\n');
  return `## ${title}\n\n${items}\n\n## Avisos\n\n${warnings}`;
}

export const LEGENDS = {
  Gestor: legend(
    'Como ler este painel',
    [
      'Pedidos registrados: pedidos que o bot conseguiu lançar no sistema de vendas no período.',
      'Valor registrado: soma, em reais, dos pedidos registrados.',
      'Ticket médio: valor registrado dividido pelo número de pedidos registrados.',
      'Resultado incerto: pedidos em que o bot não recebeu uma confirmação clara do sistema de vendas e que precisam de conferência manual.',
      'Conversão madura: percentual das compras iniciadas há mais de 24 horas que terminaram em pedido registrado.',
      'Conversão total: o mesmo cálculo, incluindo as compras iniciadas nas últimas 24 horas.',
      'Compras por dia: quantas compras o bot iniciou, quantas chegaram ao resumo do pedido e quantas viraram venda registrada.',
      'Abandono por última etapa: compras iniciadas há mais de 24 horas que ficaram sem desfecho, agrupadas pela etapa em que a conversa parou.',
    ],
    [
      'A conversão madura considera só as intenções com mais de 24 horas, para não contar como perdida uma compra que ainda pode ser concluída.',
    ],
  ),
  Supervisor: legend(
    'Como ler este painel',
    [
      'Espera mediana: tempo que metade das conversas esperou, desde o pedido de ajuda humana até um atendente assumir.',
      'Espera em 90% dos casos: 9 em cada 10 conversas esperaram esse tempo ou menos. Mostra os casos mais demorados sem contar os extremos.',
      'Transferido para atendente: o bot passou a conversa para uma pessoa.',
      'Transferência oferecida: o bot sugeriu a transferência ao cliente, por cliente sem avançar no pedido ou por ofensa.',
      'Motivos: pedido do cliente, emergência, falha ou recusa ao registrar a venda, resultado da venda incerto, cancelamento de venda, limite de quantidade e falha na confirmação de identidade.',
    ],
    [
      'Os tempos de espera são medidos, mas a revenda ainda não definiu uma meta. Os números mostram a situação real e não indicam se ela está boa ou ruim.',
    ],
  ),
  Técnico: legend(
    'Como ler este painel',
    [
      'Latência do turno: tempo que o bot leva para processar cada mensagem do cliente, em milissegundos (1000 ms é 1 segundo). A mediana é o tempo típico. O percentil 95 é o tempo que 95% dos turnos não passam.',
      'Chamadas de IA por hora: quantas vezes o bot consultou o modelo de linguagem, separadas pela finalidade (interpretar a mensagem, ler nome, ler endereço ou responder pergunta). Entram chamadas permitidas e bloqueadas pelo limite de uso.',
      'Chamadas à base de conhecimento por dia: perguntas do cliente que o bot tentou responder com a base de conteúdo da revenda, separadas pelo resultado. "Pergunta respondida" é o resultado esperado. Os demais indicam que o bot não soube responder.',
    ],
    [
      'Os tempos são medidos, mas não há meta definida. Servem para acompanhar mudanças ao longo dos dias.',
    ],
  ),
};

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
        title: 'Pedidos com resultado incerto',
        col: 18,
        row: 0,
        sizeX: 6,
        sizeY: 3,
      },
      {
        card: 'gestor-conversao',
        title: 'Conversão madura (compras iniciadas há mais de 24 h)',
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
        card: 'gestor-funil-diario',
        title: 'Compras por dia: iniciadas, com resumo e vendidas',
        col: 0,
        row: 6,
        sizeX: 24,
        sizeY: 8,
      },
      {
        card: 'gestor-abandono',
        title: 'Abandono por última etapa',
        col: 0,
        row: 14,
        sizeX: 24,
        sizeY: 8,
      },
      { text: LEGENDS.Gestor, col: 0, row: 22, sizeX: 24, sizeY: 10 },
    ],
  },
  {
    name: 'Supervisor',
    collection: 'Supervisor',
    cards: [
      {
        card: 'supervisor-espera',
        title: 'Espera até um atendente assumir (mediana)',
        col: 0,
        row: 0,
        sizeX: 12,
        sizeY: 3,
      },
      {
        card: 'supervisor-espera-p90',
        title: 'Espera até um atendente assumir (90% dos casos)',
        col: 12,
        row: 0,
        sizeX: 12,
        sizeY: 3,
      },
      {
        card: 'supervisor-handoffs',
        title: 'Transferências para atendente por motivo',
        col: 0,
        row: 3,
        sizeX: 24,
        sizeY: 8,
      },
      { text: LEGENDS.Supervisor, col: 0, row: 11, sizeX: 24, sizeY: 8 },
    ],
  },
  {
    name: 'Técnico',
    collection: 'Técnico',
    cards: [
      {
        card: 'tecnico-latencia',
        title: 'Tempo de resposta do bot por dia (ms)',
        col: 0,
        row: 0,
        sizeX: 24,
        sizeY: 8,
      },
      {
        card: 'tecnico-ia',
        title: 'Chamadas de IA por hora e finalidade',
        col: 0,
        row: 8,
        sizeX: 24,
        sizeY: 8,
      },
      {
        card: 'tecnico-rag',
        title: 'Chamadas à base de conhecimento por dia e resultado',
        col: 0,
        row: 16,
        sizeX: 24,
        sizeY: 8,
      },
      { text: LEGENDS.Técnico, col: 0, row: 24, sizeX: 24, sizeY: 8 },
    ],
  },
];

const VARIABLES = {
  dias: {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Período (dias)',
    sectionId: 'number',
    tagType: 'number',
    tagDefault: '30',
    parameterType: 'number/=',
    parameterDefault: 30,
  },
  incluir_simulados: {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Incluir dados simulados',
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

export const SITE_LOCALE = 'pt_BR';

export function sameLocale(current, wanted) {
  const normalize = value =>
    String(value ?? '')
      .replaceAll('-', '_')
      .toLowerCase();
  return normalize(current) === normalize(wanted);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const body = Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stable(value[key])}`);
    return `{${body.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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
      displayName: tag['display-name'] ?? null,
      type: tag.type,
      required: Boolean(tag.required),
      default: tag.default === undefined ? null : firstValue(tag.default),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parameters = (card.parameters ?? [])
    .map(parameter => ({
      slug: parameter.slug,
      name: parameter.name,
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
    stable(summarizeCard(existing, desired.visualization_settings)) ===
    stable(summarizeCard(desired, desired.visualization_settings));
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

const VIRTUAL_TEXT_CARD = {
  virtual_card: {
    name: null,
    display: 'text',
    visualization_settings: {},
    dataset_query: {},
    archived: false,
  },
};

export function buildDashboardPayload({ name, collectionId, cards }) {
  return {
    name,
    collection_id: collectionId,
    parameters: buildDashboardParameters(),
    dashcards: cards.map((card, index) => ({
      id: -(index + 1),
      card_id: card.text === undefined ? card.cardId : null,
      col: card.col,
      row: card.row,
      size_x: card.sizeX,
      size_y: card.sizeY,
      parameter_mappings:
        card.text === undefined ? buildDashcardMappings(card.cardId, card.sql) : [],
      visualization_settings:
        card.text === undefined
          ? card.title
            ? { 'card.title': card.title }
            : {}
          : { ...VIRTUAL_TEXT_CARD, text: card.text },
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
      text: dashcard.visualization_settings?.text ?? null,
      mappings: (dashcard.parameter_mappings ?? [])
        .map(mapping => `${mapping.parameter_id}=${JSON.stringify(mapping.target)}`)
        .sort(),
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  return { name: dashboard.name, collectionId: dashboard.collection_id, parameters, dashcards };
}

export function planDashboard(existing, desired) {
  if (!existing) return 'create';
  const same = stable(summarizeDashboard(existing)) === stable(summarizeDashboard(desired));
  return same ? 'unchanged' : 'update';
}

export function reuseDashcardIds(existing, desired) {
  const keyOf = dashcard => dashcard.card_id ?? `texto:${dashcard.row}:${dashcard.col}`;
  const byCard = new Map(
    (existing?.dashcards ?? []).map(dashcard => [keyOf(dashcard), dashcard.id]),
  );
  return {
    ...desired,
    dashcards: desired.dashcards.map(dashcard => ({
      ...dashcard,
      id: byCard.get(keyOf(dashcard)) ?? dashcard.id,
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
