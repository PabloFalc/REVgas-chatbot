import { readFileSync } from 'node:fs';
import { buildBody, filterEnv, normalizeApiBase, referencedVars } from './dokploy-push.lib.mjs';

const USAGE =
  'uso: DOKPLOY_URL=... DOKPLOY_API_KEY=... dokploy-push.mjs <composeId> <compose.yaml> <env>';

async function main() {
  const [composeId, composePath, envPath] = process.argv.slice(2);
  const { DOKPLOY_URL, DOKPLOY_API_KEY } = process.env;
  if (!composeId || !composePath || !envPath) throw new Error(USAGE);
  if (!DOKPLOY_URL || !DOKPLOY_API_KEY) throw new Error('defina DOKPLOY_URL e DOKPLOY_API_KEY');

  const composeFile = readFileSync(composePath, 'utf8');
  const { env, dropped } = filterEnv(readFileSync(envPath, 'utf8'), referencedVars(composeFile));
  if (dropped.length > 0)
    console.log(`chaves fora do compose, não enviadas: ${dropped.join(', ')}`);

  let response;
  try {
    response = await fetch(`${normalizeApiBase(DOKPLOY_URL)}/compose.update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': DOKPLOY_API_KEY },
      body: JSON.stringify(buildBody({ composeId, composeFile, env })),
    });
  } catch (error) {
    throw new Error(`sem resposta do Dokploy: ${error.cause?.code ?? error.name}`);
  }
  console.log(`HTTP ${response.status}`);
  if (!response.ok) process.exit(1);
}

main().catch(error => {
  console.error(`falha: ${error.message}`);
  process.exit(1);
});
