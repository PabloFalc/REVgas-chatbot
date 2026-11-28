export function normalizeApiBase(url) {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export const REQUEST_TIMEOUT_MS = 30_000;

export function assertSecureUrl(url) {
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('DOKPLOY_URL inválida');
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new Error('DOKPLOY_URL precisa ser https (http só para localhost ou 127.0.0.1)');
  }
}

export function confirmTarget({ status, body, expectedName }) {
  if (status !== 200) throw new Error(`compose.one respondeu HTTP ${status}, nada foi enviado`);
  const name = body && typeof body === 'object' ? body.name : undefined;
  if (name !== expectedName) {
    throw new Error(
      `o compose encontrado tem outro nome (esperado "${expectedName}"), nada foi enviado`,
    );
  }
  return name;
}

export function referencedVars(compose) {
  const names = new Set();
  for (const match of compose.matchAll(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(match[1]);
  return names;
}

export function filterEnv(envText, allowed) {
  const kept = [];
  const dropped = [];
  for (const line of envText.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match) continue;
    if (allowed.has(match[1])) kept.push(line);
    else dropped.push(match[1]);
  }
  return { env: `${kept.join('\n')}\n`, dropped };
}

export function buildBody({ composeId, composeFile, env }) {
  return { composeId, composeFile, env, sourceType: 'raw' };
}
