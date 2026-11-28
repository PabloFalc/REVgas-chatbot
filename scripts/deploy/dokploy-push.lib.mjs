export function normalizeApiBase(url) {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
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
