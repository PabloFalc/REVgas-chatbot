import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  buildCardPayload,
  buildDashboardPayload,
  buildDatabasePayload,
  CARDS,
  COLLECTIONS,
  DASHBOARDS,
  DATABASE_NAME,
  findByName,
  loadConfig,
  planCard,
  planDashboard,
  planDatabase,
  redact,
  reuseDashcardIds,
  SITE_LOCALE,
  sameLocale,
  VIEWS,
  wrapSql,
} from './provision.lib.mjs';

const REPORT_TIMEZONE = 'America/Sao_Paulo';
const HEALTH_TIMEOUT_MS = 180_000;
const SQL_DIR = fileURLToPath(new URL('../../docs/guides/metrics/sql/', import.meta.url));

const LABELS = { create: 'criado', update: 'atualizado', unchanged: 'sem mudança' };
const summary = { create: 0, update: 0, unchanged: 0 };

function report(kind, text) {
  summary[kind] += 1;
  console.log(`  ${LABELS[kind]}: ${text}`);
}

function createClient(config) {
  const secrets = [config.apiKey, config.adminPassword, config.readerPassword];
  const headers = { 'content-type': 'application/json' };
  if (config.apiKey) headers['x-api-key'] = config.apiKey;

  async function call(method, path, body, { allow } = {}) {
    let response;
    try {
      response = await fetch(`${config.url}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(
        redact(
          `${method} ${path} falhou sem resposta: ${error.cause?.code ?? error.message}`,
          secrets,
        ),
      );
    }
    const text = await response.text();
    if (!response.ok && !(allow ?? []).includes(response.status)) {
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message = parsed.message ?? JSON.stringify(parsed.errors ?? parsed);
      } catch {}
      throw new Error(
        redact(`${method} ${path} respondeu ${response.status}: ${message.slice(0, 300)}`, secrets),
      );
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    get: path => call('GET', path),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
    setSession: id => {
      headers['x-metabase-session'] = id;
    },
    hasApiKey: Boolean(config.apiKey),
  };
}

async function waitForHealth(config) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let last = 'sem resposta';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${config.url}/api/health`);
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.status === 'ok') return;
      last = `status ${body.status ?? response.status}`;
    } catch (error) {
      last = error.cause?.code ?? error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(
    `Metabase não ficou saudável em ${config.url}/api/health em ${HEALTH_TIMEOUT_MS / 1000}s (${last}).`,
  );
}

async function authenticate(config, client) {
  const properties = await client.get('/api/session/properties');
  if (!properties['has-user-setup']) {
    if (!config.adminEmail || !config.adminPassword) {
      throw new Error(
        'A instância ainda não tem administrador. Informe METABASE_ADMIN_EMAIL e METABASE_ADMIN_PASSWORD.',
      );
    }
    const session = await client.post('/api/setup', {
      token: properties['setup-token'],
      user: { email: config.adminEmail, password: config.adminPassword },
      prefs: { site_name: 'RevGás' },
    });
    client.setSession(session.id);
    report('create', `administrador ${config.adminEmail} (setup inicial)`);
    return;
  }
  if (client.hasApiKey) {
    await client.get('/api/user/current');
    console.log('  autenticado com chave de API');
    return;
  }
  const session = await client.post('/api/session', {
    username: config.adminEmail,
    password: config.adminPassword,
  });
  client.setSession(session.id);
  console.log(`  autenticado como ${config.adminEmail}`);
}

async function provisionSettings(client) {
  const settings = await client.get('/api/setting');
  const timezone = findSetting(settings, 'report-timezone');
  if (timezone?.value === REPORT_TIMEZONE) {
    report('unchanged', `fuso dos relatórios ${REPORT_TIMEZONE}`);
  } else {
    await client.put('/api/setting/report-timezone', { value: REPORT_TIMEZONE });
    report('update', `fuso dos relatórios ${REPORT_TIMEZONE}`);
  }
  let locale = findSetting(settings, 'site-locale');
  if (!locale) {
    const properties = await client.get('/api/session/properties');
    locale = { value: properties['site-locale'] };
  }
  if (sameLocale(locale.value, SITE_LOCALE)) {
    report('unchanged', `idioma da instância ${SITE_LOCALE}`);
  } else {
    await client.put('/api/setting/site-locale', { value: SITE_LOCALE });
    report('update', `idioma da instância ${SITE_LOCALE}`);
  }
  const tracking = findSetting(settings, 'anon-tracking-enabled');
  if (tracking?.is_env_setting) {
    console.log(
      `  telemetria anônima controlada pela variável ${tracking.env_name} do container; valor não consultável pela API`,
    );
  } else if (tracking?.value === false) {
    report('unchanged', 'telemetria anônima desligada');
  } else {
    await client.put('/api/setting/anon-tracking-enabled', { value: false });
    report('update', 'telemetria anônima desligada');
  }
}

function findSetting(settings, key) {
  return settings.find(setting => setting.key === key);
}

async function provisionDatabase(config, client, forcePassword) {
  const list = await client.get('/api/database');
  const existing = findByName(list.data, DATABASE_NAME);
  const desired = buildDatabasePayload(config);
  const action = planDatabase(existing, desired, forcePassword);
  const label = `conexão "${DATABASE_NAME}"`;
  if (action === 'create') {
    const created = await client.post('/api/database', desired);
    report('create', label);
    return created.id;
  }
  if (action === 'update') {
    await client.put(`/api/database/${existing.id}`, {
      details: desired.details,
      is_full_sync: desired.is_full_sync,
      auto_run_queries: desired.auto_run_queries,
    });
    report('update', label);
    return existing.id;
  }
  report(
    'unchanged',
    `${label} (a senha não é comparável pela API; use --atualizar-senha para reenviá-la)`,
  );
  return existing.id;
}

async function provisionCollections(client) {
  const all = await client.get('/api/collection?archived=false');
  const topLevel = all.filter(
    item => typeof item.id === 'number' && item.location === '/' && !item.personal_owner_id,
  );
  const ids = {};
  for (const name of COLLECTIONS) {
    const existing = findByName(topLevel, name);
    if (existing) {
      ids[name] = existing.id;
      report('unchanged', `coleção "${name}"`);
    } else {
      const created = await client.post('/api/collection', { name });
      ids[name] = created.id;
      report('create', `coleção "${name}"`);
    }
  }
  return ids;
}

async function provisionCards(client, databaseId, collectionIds) {
  const provisioned = {};
  for (const { name, title, sqlFile, collection, display, settings } of CARDS) {
    const sql = wrapSql(await readFile(`${SQL_DIR}${sqlFile}.sql`, 'utf8'), VIEWS[sqlFile]);
    const collectionId = collectionIds[collection];
    const desired = buildCardPayload({
      name: title,
      sql,
      databaseId,
      collectionId,
      display,
      visualizationSettings: settings,
    });
    const items = await client.get(`/api/collection/${collectionId}/items?models=card&limit=500`);
    const found = findByName(items.data, title) ?? findByName(items.data, name);
    const existing = found ? await client.get(`/api/card/${found.id}`) : undefined;
    const action = planCard(existing, desired);
    const label = `pergunta "${title}" (coleção ${collection}, ${display})`;
    let id = existing?.id;
    if (action === 'create') {
      id = (await client.post('/api/card', desired)).id;
    } else if (action === 'update') {
      await client.put(`/api/card/${existing.id}`, desired);
    }
    provisioned[name] = { id, sql };
    report(action, label);
  }
  return provisioned;
}

async function provisionDashboards(client, collectionIds, cards) {
  for (const { name, collection, cards: layout } of DASHBOARDS) {
    const collectionId = collectionIds[collection];
    const desired = buildDashboardPayload({
      name,
      collectionId,
      cards: layout.map(item => ({
        cardId: item.card ? cards[item.card].id : null,
        sql: item.card ? cards[item.card].sql : null,
        text: item.text,
        col: item.col,
        row: item.row,
        sizeX: item.sizeX,
        sizeY: item.sizeY,
        title: item.title,
      })),
    });
    const items = await client.get(
      `/api/collection/${collectionId}/items?models=dashboard&limit=500`,
    );
    const found = findByName(items.data, name);
    const existing = found ? await client.get(`/api/dashboard/${found.id}`) : undefined;
    const action = planDashboard(existing, desired);
    if (action !== 'unchanged') {
      const id =
        existing?.id ??
        (await client.post('/api/dashboard', { name, collection_id: collectionId })).id;
      const { parameters, dashcards } = reuseDashcardIds(existing, desired);
      await client.put(`/api/dashboard/${id}`, { parameters, dashcards });
    }
    report(action, `dashboard "${name}" (coleção ${collection})`);
  }
}

async function main() {
  const config = loadConfig(process.env);
  const forcePassword = process.argv.includes('--atualizar-senha');
  const client = createClient(config);

  console.log(`Metabase em ${config.url}`);
  await waitForHealth(config);
  console.log('Autenticação');
  await authenticate(config, client);
  console.log('Configurações');
  await provisionSettings(client);
  console.log('Conexão');
  const databaseId = await provisionDatabase(config, client, forcePassword);
  console.log('Coleções');
  const collectionIds = await provisionCollections(client);
  console.log('Perguntas');
  const cards = await provisionCards(client, databaseId, collectionIds);
  console.log('Dashboards');
  await provisionDashboards(client, collectionIds, cards);

  console.log(
    `Concluído: ${summary.create} criado(s), ${summary.update} atualizado(s), ${summary.unchanged} sem mudança.`,
  );
}

main().catch(error => {
  console.error(`Falha no provisionamento: ${error.message}`);
  process.exit(1);
});
