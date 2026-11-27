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
      for (const item of dashboard.cards) {
        const card = CARDS.find(candidate => candidate.name === item.card);
        expect(card, item.card).toBeDefined();
        expect(card?.collection).toBe(dashboard.collection);
      }
    }
  });

  it('nomes de cards são únicos e todo card está em algum dashboard', () => {
    const names = CARDS.map(card => card.name);
    expect(new Set(names).size).toBe(names.length);
    const used = DASHBOARDS.flatMap(dashboard => dashboard.cards.map(item => item.card));
    expect([...names].sort()).toEqual([...used].sort());
  });

  it('cria o dashboard Técnico com latência, IA e RAG', () => {
    const tecnico = DASHBOARDS.find(dashboard => dashboard.name === 'Técnico');
    expect(tecnico?.cards.map(item => item.card)).toEqual([
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
    expect(ia?.settings['graph.dimensions']).toEqual(['hora', 'reason']);
    expect(ia?.settings['stackable.stack_type']).toBe('stacked');
  });

  it('moeda e percentuais usam separadores brasileiros', () => {
    const valor = CARDS.find(card => card.name === 'gestor-vendas-valor');
    expect(valor?.settings.column_settings['["name","valor_registrado_brl"]']).toMatchObject({
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
      name: 'Dias',
      slug: 'dias',
      type: 'number/=',
      default: 30,
    });
    expect(simulados).toMatchObject({
      name: 'Incluir simulados',
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
