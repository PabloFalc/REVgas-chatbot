import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCardPayload,
  buildDashboardParameters,
  buildDashboardPayload,
  buildDashcardMappings,
  buildDatabasePayload,
  buildParameters,
  buildTemplateTags,
  CARDS,
  COLLECTIONS,
  DASHBOARDS,
  extractTemplateTagNames,
  findByName,
  loadConfig,
  planCard,
  planDashboard,
  planDatabase,
  redact,
  reuseDashcardIds,
  sameLocale,
  TRANSLATIONS,
  textHeight,
  VIEWS,
  wrapSql,
} from './provision.lib.mjs';

const SQL = `-- {{comentario}} fica de fora? não, o regex pega
SELECT {{dias}}, {{ incluir_simulados }}, {{dias}}`;
const SQL_LIMPO = 'SELECT {{dias}}, {{ incluir_simulados }}, {{dias}}';

function lerComoApi(original: ReturnType<typeof buildCardPayload>) {
  const payload = structuredClone(original);
  const native = payload.dataset_query.native;
  return {
    id: 7,
    name: payload.name,
    collection_id: payload.collection_id,
    database_id: payload.dataset_query.database,
    dataset_query: {
      'lib/type': 'mbql/query',
      database: payload.dataset_query.database,
      stages: [
        {
          'lib/type': 'mbql.stage/native',
          native: native.query,
          'template-tags': Object.values(native['template-tags']),
        },
      ],
    },
    display: payload.display,
    visualization_settings: { ...payload.visualization_settings, 'extra.key': true },
    parameters: payload.parameters,
  };
}

describe('extractTemplateTagNames', () => {
  it('devolve nomes únicos na ordem, aceitando espaços dentro das chaves', () => {
    expect(extractTemplateTagNames(SQL_LIMPO)).toEqual(['dias', 'incluir_simulados']);
  });

  it('SQL sem variável devolve lista vazia', () => {
    expect(extractTemplateTagNames('SELECT 1')).toEqual([]);
  });

  it('contabiliza variáveis citadas em comentários, pois o Metabase também as lê', () => {
    expect(extractTemplateTagNames(SQL)).toContain('comentario');
  });
});

describe('buildTemplateTags', () => {
  const tags = buildTemplateTags(SQL_LIMPO);

  it('dias é numérica, obrigatória, padrão 30', () => {
    expect(tags.dias).toMatchObject({
      name: 'dias',
      type: 'number',
      required: true,
      default: '30',
    });
  });

  it('incluir_simulados é texto, obrigatória, padrão nao', () => {
    expect(tags.incluir_simulados).toMatchObject({
      name: 'incluir_simulados',
      type: 'text',
      required: true,
      default: 'nao',
    });
  });

  it('recusa variável sem definição conhecida', () => {
    expect(() => buildTemplateTags('SELECT {{outra}}')).toThrow(/outra/);
  });

  it('só cria as variáveis que o SQL usa', () => {
    expect(Object.keys(buildTemplateTags('SELECT {{dias}}'))).toEqual(['dias']);
  });
});

describe('buildParameters', () => {
  const params = buildParameters(SQL_LIMPO);
  const porSlug = Object.fromEntries(params.map((p: { slug: string }) => [p.slug, p]));

  it('liga cada parâmetro ao template-tag pelo mesmo id e alvo', () => {
    const tags = buildTemplateTags(SQL_LIMPO);
    expect(porSlug.dias.id).toBe(tags.dias.id);
    expect(porSlug.dias.target).toEqual(['variable', ['template-tag', 'dias']]);
  });

  it('dias é numérica obrigatória com padrão 30', () => {
    expect(porSlug.dias).toMatchObject({ type: 'number/=', required: true, default: 30 });
  });

  it('incluir_simulados tem lista fixa nao e sim', () => {
    expect(porSlug.incluir_simulados).toMatchObject({
      type: 'string/=',
      required: true,
      default: ['nao'],
      values_query_type: 'list',
      values_source_type: 'static-list',
      values_source_config: { values: ['nao', 'sim'] },
    });
  });
});

describe('buildCardPayload', () => {
  it('monta consulta nativa na conexão e coleção informadas', () => {
    const payload = buildCardPayload({
      name: 'gestor-vendas',
      sql: SQL_LIMPO,
      databaseId: 3,
      collectionId: 9,
    });
    expect(payload.name).toBe('gestor-vendas');
    expect(payload.collection_id).toBe(9);
    expect(payload.dataset_query.type).toBe('native');
    expect(payload.dataset_query.database).toBe(3);
    expect(payload.dataset_query.native.query).toBe(SQL_LIMPO);
    expect(Object.keys(payload.dataset_query.native['template-tags'])).toEqual([
      'dias',
      'incluir_simulados',
    ]);
  });
});

describe('planCard', () => {
  const desired = buildCardPayload({
    name: 'gestor-vendas',
    sql: SQL_LIMPO,
    databaseId: 3,
    collectionId: 9,
  });

  it('sem card existente manda criar', () => {
    expect(planCard(undefined, desired)).toBe('create');
  });

  it('card igual, lido no formato da API, não muda', () => {
    expect(planCard(lerComoApi(desired), desired)).toBe('unchanged');
  });

  it('SQL diferente manda atualizar', () => {
    const outro = buildCardPayload({
      name: 'gestor-vendas',
      sql: 'SELECT {{dias}}',
      databaseId: 3,
      collectionId: 9,
    });
    expect(planCard(lerComoApi(outro), desired)).toBe('update');
  });

  it('padrão da variável alterado na interface manda atualizar', () => {
    const lido = lerComoApi(desired);
    const tags = lido.dataset_query.stages[0]['template-tags'] as { default: string }[];
    tags[0].default = '7';
    expect(planCard(lido, desired)).toBe('update');
  });

  it('variável deixada opcional manda atualizar', () => {
    const lido = lerComoApi(desired);
    lido.parameters[0].required = false;
    expect(planCard(lido, desired)).toBe('update');
  });

  it('lista de valores diferente manda atualizar', () => {
    const lido = lerComoApi(desired);
    lido.parameters[1].values_source_config = { values: ['nao'] };
    expect(planCard(lido, desired)).toBe('update');
  });

  it('conexão diferente manda atualizar', () => {
    const lido = lerComoApi(desired);
    lido.database_id = 99;
    lido.dataset_query.database = 99;
    expect(planCard(lido, desired)).toBe('update');
  });
});

describe('visualização do card', () => {
  const base = { name: 'x', sql: 'SELECT 1', databaseId: 3, collectionId: 9 };

  it('sem visualização informada mantém tabela sem configurações', () => {
    const payload = buildCardPayload(base);
    expect(payload.display).toBe('table');
    expect(payload.visualization_settings).toEqual({});
  });

  it('usa display e configurações informados', () => {
    const payload = buildCardPayload({
      ...base,
      display: 'bar',
      visualizationSettings: { 'graph.dimensions': ['a'], 'graph.metrics': ['b'] },
    });
    expect(payload.display).toBe('bar');
    expect(payload.visualization_settings).toEqual({
      'graph.dimensions': ['a'],
      'graph.metrics': ['b'],
    });
  });

  it('planCard ignora chaves extras que o Metabase acrescenta nas configurações', () => {
    const desired = buildCardPayload({
      ...base,
      display: 'scalar',
      visualizationSettings: { 'scalar.field': 'a' },
    });
    expect(planCard(lerComoApi(desired), desired)).toBe('unchanged');
  });

  it('planCard manda atualizar quando o tipo de gráfico mudou', () => {
    const desired = buildCardPayload({ ...base, display: 'bar' });
    const lido = lerComoApi(desired);
    lido.display = 'table';
    expect(planCard(lido, desired)).toBe('update');
  });

  it('planCard manda atualizar quando uma configuração mudou', () => {
    const desired = buildCardPayload({
      ...base,
      display: 'scalar',
      visualizationSettings: { 'scalar.field': 'a' },
    });
    const lido = lerComoApi(desired);
    lido.visualization_settings['scalar.field'] = 'b';
    expect(planCard(lido, desired)).toBe('update');
  });
});

describe('catálogo de cards e dashboards', () => {
  it('cada dashboard e cada card ficam em coleção provisionada', () => {
    for (const card of CARDS) expect(COLLECTIONS).toContain(card.collection);
    for (const dashboard of DASHBOARDS) expect(COLLECTIONS).toContain(dashboard.collection);
  });

  it('dashboard só usa cards definidos e da mesma coleção', () => {
    for (const dashboard of DASHBOARDS) {
      for (const item of dashboard.cards.filter(candidate => candidate.card)) {
        const card = CARDS.find(candidate => candidate.name === item.card);
        expect(card, item.card).toBeDefined();
        expect(card?.collection).toBe(dashboard.collection);
      }
    }
  });

  it('nomes de cards são únicos e todo card está em algum dashboard', () => {
    const names = CARDS.map(card => card.name);
    expect(new Set(names).size).toBe(names.length);
    const used = DASHBOARDS.flatMap(dashboard =>
      dashboard.cards.flatMap(item => (item.card ? [item.card] : [])),
    );
    expect([...names].sort()).toEqual([...used].sort());
  });

  it('cria o dashboard Técnico com latência, IA e RAG', () => {
    const tecnico = DASHBOARDS.find(dashboard => dashboard.name === 'Técnico');
    expect(tecnico?.cards.flatMap(item => (item.card ? [item.card] : []))).toEqual([
      'tecnico-latencia',
      'tecnico-ia',
      'tecnico-rag',
    ]);
  });

  it('gráficos de série e empilhados definem dimensões e métricas', () => {
    const grafico = CARDS.filter(card => card.display === 'line' || card.display === 'bar');
    expect(grafico.map(card => card.name)).toEqual([
      'gestor-funil-diario',
      'gestor-abandono',
      'supervisor-handoffs',
      'tecnico-latencia',
      'tecnico-ia',
      'tecnico-rag',
    ]);
    for (const card of grafico) {
      expect(card.settings['graph.dimensions'].length).toBeGreaterThan(0);
      expect(card.settings['graph.metrics'].length).toBeGreaterThan(0);
    }
    const ia = CARDS.find(card => card.name === 'tecnico-ia');
    expect(ia?.settings['graph.dimensions']).toEqual(['Hora', 'Finalidade']);
    expect(ia?.settings['stackable.stack_type']).toBe('stacked');
  });

  it('moeda e percentuais usam separadores brasileiros', () => {
    const valor = CARDS.find(card => card.name === 'gestor-vendas-valor');
    expect(valor?.settings.column_settings['["name","Valor registrado (R$)"]']).toMatchObject({
      number_style: 'currency',
      currency: 'BRL',
      number_separators: ',.',
      decimals: 2,
    });
  });
});

describe('dashboard', () => {
  const sqlDias = 'SELECT {{dias}}, {{incluir_simulados}}';
  const cards = [
    { cardId: 5, sql: sqlDias, col: 0, row: 0, sizeX: 12, sizeY: 3, title: 'Um' },
    { cardId: 6, sql: 'SELECT {{dias}}', col: 12, row: 0, sizeX: 12, sizeY: 3 },
  ];
  const desired = buildDashboardPayload({ name: 'Gestor', collectionId: 9, cards });

  function lerDashboard(original: typeof desired) {
    const payload = structuredClone(original);
    return {
      id: 4,
      name: payload.name,
      collection_id: payload.collection_id,
      parameters: payload.parameters.map((p: object) => ({ ...p, sectionId: 'x' })),
      dashcards: payload.dashcards.map((d: { id: number }, i: number) => ({
        ...d,
        id: 100 + i,
        entity_id: 'abc',
      })),
    };
  }

  it('cria filtros Dias e Incluir simulados com os padrões das perguntas', () => {
    const [dias, simulados] = buildDashboardParameters();
    expect(dias).toMatchObject({
      name: 'Período (dias)',
      slug: 'dias',
      type: 'number/=',
      default: 30,
    });
    expect(simulados).toMatchObject({
      name: 'Incluir dados simulados',
      slug: 'incluir_simulados',
      type: 'string/=',
      default: ['nao'],
      values_source_type: 'static-list',
      values_source_config: { values: ['nao', 'sim'] },
    });
  });

  it('mapeia cada filtro às variáveis que o SQL do card usa', () => {
    const [dias, simulados] = buildDashboardParameters();
    expect(buildDashcardMappings(5, sqlDias)).toEqual([
      {
        card_id: 5,
        parameter_id: dias.id,
        target: ['variable', ['template-tag', 'dias']],
      },
      {
        card_id: 5,
        parameter_id: simulados.id,
        target: ['variable', ['template-tag', 'incluir_simulados']],
      },
    ]);
  });

  it('só mapeia as variáveis presentes no SQL', () => {
    expect(buildDashcardMappings(6, 'SELECT {{dias}}')).toHaveLength(1);
  });

  it('monta dashcards com posição, mapeamentos e título', () => {
    expect(desired.name).toBe('Gestor');
    expect(desired.collection_id).toBe(9);
    expect(desired.dashcards).toHaveLength(2);
    expect(desired.dashcards[0]).toMatchObject({
      card_id: 5,
      col: 0,
      row: 0,
      size_x: 12,
      size_y: 3,
      visualization_settings: { 'card.title': 'Um' },
    });
    expect(desired.dashcards[0].parameter_mappings).toHaveLength(2);
    expect(desired.dashcards[1].visualization_settings).toEqual({});
  });

  it('usa ids temporários negativos e distintos nos dashcards', () => {
    const ids = desired.dashcards.map((d: { id: number }) => d.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id: number) => id < 0)).toBe(true);
  });

  it('reaproveita o id do dashcard existente do mesmo card', () => {
    const lido = lerDashboard(desired);
    const novo = reuseDashcardIds(lido, desired);
    expect(novo.dashcards.map((d: { id: number }) => d.id)).toEqual([100, 101]);
    expect(reuseDashcardIds(undefined, desired).dashcards[0].id).toBe(-1);
  });

  it('sem dashboard existente manda criar', () => {
    expect(planDashboard(undefined, desired)).toBe('create');
  });

  it('dashboard igual, lido no formato da API, não muda', () => {
    expect(planDashboard(lerDashboard(desired), desired)).toBe('unchanged');
  });

  it('card removido do dashboard manda atualizar', () => {
    const lido = lerDashboard(desired);
    lido.dashcards.pop();
    expect(planDashboard(lido, desired)).toBe('update');
  });

  it('mapeamento perdido manda atualizar', () => {
    const lido = lerDashboard(desired);
    lido.dashcards[0].parameter_mappings.pop();
    expect(planDashboard(lido, desired)).toBe('update');
  });

  it('padrão de filtro alterado manda atualizar', () => {
    const lido = lerDashboard(desired);
    lido.parameters[0].default = 7;
    expect(planDashboard(lido, desired)).toBe('update');
  });

  it('posição diferente manda atualizar', () => {
    const lido = lerDashboard(desired);
    lido.dashcards[1].row = 9;
    expect(planDashboard(lido, desired)).toBe('update');
  });

  it('título diferente manda atualizar', () => {
    const lido = lerDashboard(desired);
    lido.dashcards[0].visualization_settings = {};
    expect(planDashboard(lido, desired)).toBe('update');
  });
});

describe('buildDatabasePayload e planDatabase', () => {
  const config = {
    readerHost: 'postgres',
    readerPort: 5432,
    readerName: 'revgas',
    readerUser: 'metrics_reader',
    readerPassword: 'senha-ficticia',
  };
  const desired = buildDatabasePayload(config);
  const existente = {
    id: 2,
    name: desired.name,
    details: { ...desired.details, password: '**MetabasePass**' },
  };

  it('usa o nome fixo e o engine postgres', () => {
    expect(desired.name).toBe('RevGás (leitura)');
    expect(desired.engine).toBe('postgres');
    expect(desired.details).toMatchObject({
      host: 'postgres',
      port: 5432,
      dbname: 'revgas',
      user: 'metrics_reader',
      password: 'senha-ficticia',
    });
  });

  it('sem conexão existente manda criar', () => {
    expect(planDatabase(undefined, desired, false)).toBe('create');
  });

  it('mesmos dados, senha mascarada pela API: não muda', () => {
    expect(planDatabase(existente, desired, false)).toBe('unchanged');
  });

  it('host diferente manda atualizar', () => {
    const outro = { ...existente, details: { ...existente.details, host: 'outro' } };
    expect(planDatabase(outro, desired, false)).toBe('update');
  });

  it('força a atualização para trocar a senha, que a API não devolve', () => {
    expect(planDatabase(existente, desired, true)).toBe('update');
  });
});

describe('findByName', () => {
  it('acha pelo nome exato e devolve undefined quando não há', () => {
    const lista = [
      { name: 'A', id: 1 },
      { name: 'B', id: 2 },
    ];
    expect(findByName(lista, 'B')).toEqual({ name: 'B', id: 2 });
    expect(findByName(lista, 'b')).toBeUndefined();
  });
});

describe('loadConfig', () => {
  const base = {
    METABASE_READER_PASSWORD: 'senha-ficticia',
    METABASE_ADMIN_EMAIL: 'admin@example.test',
    METABASE_ADMIN_PASSWORD: 'outra-senha-ficticia',
  };

  it('aplica os padrões de URL, host, porta, banco e usuário', () => {
    expect(loadConfig(base)).toMatchObject({
      url: 'http://127.0.0.1:3001',
      readerHost: 'postgres',
      readerPort: 5432,
      readerName: 'revgas',
      readerUser: 'metrics_reader',
    });
  });

  it('remove a barra final da URL', () => {
    expect(loadConfig({ ...base, METABASE_URL: 'https://bi.exemplo.test/' }).url).toBe(
      'https://bi.exemplo.test',
    );
  });

  it('lista todas as variáveis obrigatórias que faltam, sem valores', () => {
    expect(() => loadConfig({})).toThrow(/METABASE_READER_PASSWORD/);
  });

  it('com chave de API dispensa e-mail e senha de admin', () => {
    const config = loadConfig({
      METABASE_READER_PASSWORD: 'senha-ficticia',
      METABASE_API_KEY: 'mb_chave_ficticia',
    });
    expect(config.apiKey).toBe('mb_chave_ficticia');
  });

  it('sem chave e sem e-mail e senha de admin, falha', () => {
    expect(() => loadConfig({ METABASE_READER_PASSWORD: 'x' })).toThrow(/METABASE_ADMIN_EMAIL/);
  });

  it('recusa porta inválida', () => {
    expect(() => loadConfig({ ...base, METABASE_READER_PORT: 'abc' })).toThrow(
      /METABASE_READER_PORT/,
    );
  });
});

describe('redact', () => {
  it('troca cada segredo por asteriscos', () => {
    expect(redact('erro com abc123 e xyz', ['abc123', 'xyz'])).toBe('erro com *** e ***');
  });

  it('ignora segredos vazios', () => {
    expect(redact('texto', ['', undefined])).toBe('texto');
  });
});

const SRC = (arquivo: string) => readFileSync(join(process.cwd(), 'src', arquivo), 'utf8');

function uniao(texto: string, inicio: RegExp) {
  const achado = inicio.exec(texto);
  if (!achado) throw new Error(`Trecho não encontrado: ${inicio}`);
  const resto = texto.slice(achado.index + achado[0].length);
  const bloco = resto.slice(0, resto.search(/[;}]/));
  return [...bloco.matchAll(/'([A-Za-z_]+)'/g)].map(match => match[1]);
}

function sqlCanonico(arquivo: string) {
  return readFileSync(join(process.cwd(), 'docs/guides/metrics/sql', `${arquivo}.sql`), 'utf8');
}

type NomeVisao = keyof typeof VIEWS;

describe('traduções', () => {
  const etapas = uniao(SRC('modules/conversation/flow/flow.types.ts'), /export type Step =/);
  const motivosHandoff = uniao(
    SRC('modules/handoff/contracts/handoff.types.ts'),
    /export type HandoffReason =/,
  );
  const eventos = SRC('modules/metrics/contracts/metrics.types.ts');
  const ofertas = uniao(eventos, /name: 'handoff_offered'; reason:/);
  const ia = uniao(eventos, /name: 'ai_call';[\s\S]*?reason:/);
  const rag = uniao(eventos, /name: 'rag';[\s\S]*?reason\?:/);

  it('lê as listas completas dos enums do código', () => {
    expect(etapas).toHaveLength(21);
    expect(motivosHandoff).toHaveLength(8);
    expect([...ofertas].sort()).toEqual(['offense', 'stuck']);
    expect([...ia].sort()).toEqual(['address', 'interpret', 'question', 'read_name']);
    expect([...rag].sort()).toEqual(['no_match', 'not_in_sources', 'rejected', 'unavailable']);
  });

  it('toda etapa, motivo, finalidade e resultado tem rótulo em português', () => {
    for (const etapa of etapas) expect(TRANSLATIONS.etapa, etapa).toHaveProperty(etapa);
    for (const motivo of [...motivosHandoff, ...ofertas]) {
      expect(TRANSLATIONS.motivoHandoff, motivo).toHaveProperty(motivo);
    }
    for (const finalidade of ia) expect(TRANSLATIONS.finalidadeIa).toHaveProperty(finalidade);
    for (const resultado of ['answered', ...rag]) {
      expect(TRANSLATIONS.resultadoRag).toHaveProperty(resultado);
    }
    expect(TRANSLATIONS.tipoHandoff).toHaveProperty('handoff');
    expect(TRANSLATIONS.tipoHandoff).toHaveProperty('handoff_offered');
  });

  it('cobre os valores de reserva dos SQLs', () => {
    expect(TRANSLATIONS.etapa).toHaveProperty('unknown');
    expect(TRANSLATIONS.motivoHandoff).toHaveProperty('sem_motivo');
    expect(TRANSLATIONS.finalidadeIa).toHaveProperty('sem_motivo');
  });

  it('nenhum rótulo é igual ao valor técnico nem fica vazio', () => {
    for (const grupo of Object.values(TRANSLATIONS) as Record<string, string>[]) {
      for (const [valor, rotulo] of Object.entries(grupo)) {
        expect(rotulo.trim().length).toBeGreaterThan(0);
        expect(rotulo).not.toBe(valor);
      }
    }
  });
});

describe('wrapSql', () => {
  const view = {
    columns: [
      { from: 'etapa', as: 'Etapa', translate: 'etapa' },
      { from: 'total', as: 'Total de casos' },
    ],
    orderBy: 'base.total DESC',
  };
  const sql = wrapSql(
    '-- comentário\nSELECT step AS etapa, 1 AS total FROM t WHERE x = {{dias}};\n',
    view,
  );

  it('embrulha o SQL original sem o ponto e vírgula final', () => {
    expect(sql.startsWith('WITH base AS (\n-- comentário\nSELECT step')).toBe(true);
    expect(sql).toContain('{{dias}}\n)\nSELECT');
    expect(sql).not.toContain(';');
    expect(sql.trimEnd().endsWith('ORDER BY base.total DESC')).toBe(true);
  });

  it('traduz valores conhecidos e deixa os desconhecidos como estão', () => {
    expect(sql).toContain("WHEN 'choosePayment' THEN 'Escolha do pagamento'");
    expect(sql).toContain('ELSE base.etapa::text END AS "Etapa"');
    expect(sql).toContain('base.total AS "Total de casos"');
  });

  it('preserva as variáveis para o Metabase', () => {
    expect(extractTemplateTagNames(sql)).toEqual(['dias']);
  });

  it('escapa aspas simples nos rótulos', () => {
    const grupo: Record<string, string> = TRANSLATIONS.etapa;
    grupo.__teste = "d'água";
    try {
      expect(wrapSql('SELECT 1', view)).toContain("THEN 'd''água'");
    } finally {
      delete grupo.__teste;
    }
  });

  it('toda visão só usa colunas que o SQL canônico devolve e grupos de tradução existentes', () => {
    for (const [arquivo, visao] of Object.entries(VIEWS) as [
      string,
      { columns: { from: string; translate?: string }[] },
    ][]) {
      const original = sqlCanonico(arquivo);
      for (const coluna of visao.columns) {
        const procurada = new RegExp(`\\bAS ${coluna.from}\\b|\\bSELECT ${coluna.from}\\b`);
        expect(original, `${arquivo}.${coluna.from}`).toMatch(procurada);
        if ('translate' in coluna) expect(TRANSLATIONS).toHaveProperty(coluna.translate as string);
      }
    }
  });

  it('cards usam só rótulos que existem nas suas visões', () => {
    for (const card of CARDS) {
      const rotulos = VIEWS[card.sqlFile as NomeVisao].columns.map(coluna => coluna.as);
      const usados = [
        card.settings['scalar.field'],
        ...(card.settings['graph.dimensions'] ?? []),
        ...(card.settings['graph.metrics'] ?? []),
      ].filter(Boolean);
      for (const rotulo of usados) expect(rotulos, `${card.name}.${rotulo}`).toContain(rotulo);
    }
  });
});

describe('formato brasileiro das datas', () => {
  it('colunas de data usam dia/mês/ano e hora em 24 h', () => {
    const funil = CARDS.find(card => card.name === 'gestor-funil-diario');
    expect(funil?.settings.column_settings['["name","Dia"]']).toMatchObject({
      date_style: 'D/M/YYYY',
    });
    const ia = CARDS.find(card => card.name === 'tecnico-ia');
    expect(ia?.settings.column_settings['["name","Hora"]']).toMatchObject({
      date_style: 'D/M/YYYY',
      time_style: 'HH:mm',
    });
  });

  it('gráficos têm títulos de eixo em português', () => {
    for (const card of CARDS.filter(item => item.display === 'bar' || item.display === 'line')) {
      expect(card.settings['graph.x_axis.title_text'], card.name).toBeTruthy();
      expect(card.settings['graph.y_axis.title_text'], card.name).toBeTruthy();
    }
  });

  it('sameLocale aceita pt_BR e pt-BR e recusa en', () => {
    expect(sameLocale('pt_BR', 'pt_BR')).toBe(true);
    expect(sameLocale('pt-BR', 'pt_BR')).toBe(true);
    expect(sameLocale('en', 'pt_BR')).toBe(false);
    expect(sameLocale(undefined, 'pt_BR')).toBe(false);
  });
});

describe('legendas', () => {
  const textoDe = (nome: string) =>
    DASHBOARDS.find(dashboard => dashboard.name === nome)?.cards.find(item => item.text)?.text;

  it('cada dashboard tem um cartão de texto com os avisos obrigatórios', () => {
    for (const dashboard of DASHBOARDS) {
      const textos = dashboard.cards.filter(item => item.text);
      expect(textos, dashboard.name).toHaveLength(1);
      const texto = textos[0].text as string;
      expect(texto).toContain('Como ler este painel');
      expect(texto).toContain('Incluir dados simulados');
    }
    expect(textoDe('Gestor')).toContain('mais de 24 horas');
    expect(textoDe('Supervisor')).toContain('ainda não definiu uma meta');
    expect(textoDe('Técnico')).toContain('não há meta');
  });

  it('textos não usam travessão nem negrito', () => {
    for (const dashboard of DASHBOARDS) {
      for (const item of dashboard.cards.filter(candidate => candidate.text)) {
        expect(item.text).not.toMatch(/[–—]|\*\*/);
      }
    }
  });

  const comTexto = buildDashboardPayload({
    name: 'X',
    collectionId: 1,
    cards: [
      { cardId: 5, sql: 'SELECT {{dias}}', col: 0, row: 0, sizeX: 24, sizeY: 3 },
      { text: '## Olá', col: 0, row: 3, sizeX: 24, sizeY: 4 },
    ],
  });

  it('cartão de texto vira dashcard virtual sem card nem mapeamentos', () => {
    expect(comTexto.dashcards[1]).toMatchObject({
      id: -2,
      card_id: null,
      parameter_mappings: [],
      visualization_settings: { text: '## Olá', virtual_card: { display: 'text' } },
    });
  });

  it('dashboard com texto, lido da API, não muda; texto alterado atualiza', () => {
    const lido = structuredClone(comTexto);
    lido.dashcards.forEach((dashcard: { id: number }, indice: number) => {
      dashcard.id = 50 + indice;
    });
    expect(planDashboard(lido, comTexto)).toBe('unchanged');
    const ids = reuseDashcardIds(lido, comTexto).dashcards.map((d: { id: number }) => d.id);
    expect(ids).toEqual([50, 51]);
    lido.dashcards[1].visualization_settings.text = 'antigo';
    expect(planDashboard(lido, comTexto)).toBe('update');
  });
});

describe('idempotência dos cards traduzidos', () => {
  it('cards do catálogo lidos da API não mudam; nome de filtro antigo manda atualizar', () => {
    for (const card of CARDS) {
      const sql = wrapSql(sqlCanonico(card.sqlFile), VIEWS[card.sqlFile as NomeVisao]);
      const desired = buildCardPayload({
        name: card.title,
        sql,
        databaseId: 1,
        collectionId: 2,
        display: card.display,
        visualizationSettings: card.settings,
      });
      const lido = lerComoApi(desired);
      expect(planCard(lido, desired), card.name).toBe('unchanged');
      lido.parameters[0].name = 'Dias';
      expect(planCard(lido, desired), card.name).toBe('update');
    }
  });

  it('a ordem das chaves devolvida pela API não gera atualização', () => {
    const card = CARDS.find(item => item.name === 'gestor-funil-diario');
    const desired = buildCardPayload({
      name: 'x',
      sql: 'SELECT {{dias}}',
      databaseId: 1,
      collectionId: 2,
      display: card?.display,
      visualizationSettings: card?.settings,
    });
    const lido = lerComoApi(desired);
    const colunas = lido.visualization_settings.column_settings;
    colunas['["name","Dia"]'] = Object.fromEntries(
      Object.entries(colunas['["name","Dia"]']).reverse(),
    );
    expect(planCard(lido, desired)).toBe('unchanged');
  });
});

describe('ajustes visuais', () => {
  const legendas = DASHBOARDS.map(d => d.cards.find(item => item.text)).filter(Boolean);

  it('altura da legenda cresce com o texto, sem sobra grande', () => {
    expect(textHeight('a')).toBeLessThan(textHeight('a\n'.repeat(30)));
    for (const item of legendas) {
      const linhas = String(item?.text).split('\n').length;
      expect(item?.sizeY).toBe(textHeight(item?.text));
      expect(item?.sizeY as number).toBeLessThanOrEqual(13);
      expect(item?.sizeY as number).toBeGreaterThanOrEqual(Math.ceil(linhas / 2.5));
    }
  });

  it('alturas calibradas pela medida real das telas', () => {
    const alturas = Object.fromEntries(
      DASHBOARDS.map(d => [d.name, d.cards.find(item => item.text)?.sizeY]),
    );
    expect(alturas).toEqual({ Gestor: 12, Supervisor: 10, Técnico: 10 });
  });

  it('hora usa HH:mm para não mostrar 24:00', () => {
    const ia = CARDS.find(card => card.name === 'tecnico-ia');
    expect(ia?.settings.column_settings['["name","Hora"]'].time_style).toBe('HH:mm');
  });

  it('todo cartão numérico usa separadores brasileiros', () => {
    for (const card of CARDS) {
      const colunas = card.settings.column_settings as Record<
        string,
        { number_separators?: string }
      >;
      const alvos = card.settings['scalar.field']
        ? [card.settings['scalar.field']]
        : card.settings['graph.metrics'];
      for (const campo of alvos) {
        expect(colunas[`["name","${campo}"]`]?.number_separators, `${card.name}.${campo}`).toBe(
          ',.',
        );
      }
    }
    const latencia = CARDS.find(card => card.name === 'tecnico-latencia');
    expect(latencia?.settings.column_settings['["name","Mediana (ms)"]'].decimals).toBe(0);
  });

  it('aviso do registro de pedidos só onde há valor em reais', () => {
    const tem = (nome: string) =>
      DASHBOARDS.find(d => d.name === nome)
        ?.cards.find(i => i.text)
        ?.text?.includes('não do financeiro');
    expect(tem('Gestor')).toBe(true);
    expect(tem('Supervisor')).toBe(false);
    expect(tem('Técnico')).toBe(false);
  });

  it('cartões têm título em português, únicos por coleção e diferentes do nome técnico', () => {
    for (const card of CARDS) expect(card.title).not.toBe(card.name);
    const chaves = CARDS.map(card => `${card.collection}/${card.title}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    const titulos = CARDS.map(card => card.title);
    for (const nome of CARDS.map(card => card.name)) expect(titulos).not.toContain(nome);
  });

  it('renomear não duplica: achar pelo título novo ou, na falta, pelo nome antigo', () => {
    const card = CARDS[0];
    const itens = [{ id: 7, name: card.name }];
    const achado = findByName(itens, card.title) ?? findByName(itens, card.name);
    expect(achado?.id).toBe(7);
    const desired = buildCardPayload({
      name: card.title,
      sql: 'SELECT 1',
      databaseId: 1,
      collectionId: 2,
    });
    const antigo = lerComoApi(
      buildCardPayload({ name: card.name, sql: 'SELECT 1', databaseId: 1, collectionId: 2 }),
    );
    expect(planCard(antigo, desired)).toBe('update');
    expect(planCard(lerComoApi(desired), desired)).toBe('unchanged');
    const renomeados = [{ id: 7, name: card.title }];
    expect(findByName(renomeados, card.title)?.id).toBe(7);
  });
});
