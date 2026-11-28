import { readFileSync } from 'node:fs';
import {
  assertSecureUrl,
  buildBody,
  confirmTarget,
  filterEnv,
  normalizeApiBase,
  REQUEST_TIMEOUT_MS,
  referencedVars,
} from './dokploy-push.lib.mjs';

const USAGE =
  'uso: DOKPLOY_URL=... DOKPLOY_API_KEY=... dokploy-push.mjs --name <nome-do-compose> <composeId> <compose.yaml> <env>';

function parseArgs(argv) {
  const positional = [];
  let name;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--name') name = argv[++i];
    else positional.push(argv[i]);
  }
  return { name, positional };
}

async function call(url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`sem resposta do Dokploy: ${error.cause?.code ?? error.name}`);
  }
}

async function main() {
  const { name, positional } = parseArgs(process.argv.slice(2));
  const [composeId, composePath, envPath] = positional;
  const { DOKPLOY_URL, DOKPLOY_API_KEY } = process.env;
  if (!name || !composeId || !composePath || !envPath || positional.length !== 3)
    throw new Error(USAGE);
  if (!DOKPLOY_URL || !DOKPLOY_API_KEY) throw new Error('defina DOKPLOY_URL e DOKPLOY_API_KEY');
  assertSecureUrl(DOKPLOY_URL);

  const composeFile = readFileSync(composePath, 'utf8');
  const { env, dropped } = filterEnv(readFileSync(envPath, 'utf8'), referencedVars(composeFile));
  if (dropped.length > 0)
    console.log(`chaves fora do compose, não enviadas: ${dropped.join(', ')}`);

  const api = normalizeApiBase(DOKPLOY_URL);
  const headers = { 'x-api-key': DOKPLOY_API_KEY };

  const lookup = await call(`${api}/compose.one?composeId=${encodeURIComponent(composeId)}`, {
    headers,
  });
  const body = await lookup.json().catch(() => undefined);
  console.log(
    `alvo confirmado: ${confirmTarget({ status: lookup.status, body, expectedName: name })}`,
  );

  const response = await call(`${api}/compose.update`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(buildBody({ composeId, composeFile, env })),
  });
  console.log(`HTTP ${response.status}`);
  if (!response.ok) process.exit(1);
}

main().catch(error => {
  console.error(`falha: ${error.message}`);
  process.exit(1);
});
