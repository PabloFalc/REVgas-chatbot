const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres']);

export const ALLOW_REMOTE_SEED_VAR = 'SEED_ALLOW_REMOTE';

export type SeedTargetDecision = { allowed: true } | { allowed: false; message: string };

export interface SeedTargetInput {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  allowRemote: string | undefined;
}

function hostnameOf(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function decideSeedTarget(input: SeedTargetInput): SeedTargetDecision {
  if (input.nodeEnv === 'production') {
    return {
      allowed: false,
      message: 'Recusado: o seed de demonstração não roda com NODE_ENV=production.',
    };
  }
  const hostname = hostnameOf(input.databaseUrl);
  if (hostname === null) {
    return {
      allowed: false,
      message: 'Recusado: não foi possível identificar o host da DATABASE_URL.',
    };
  }
  if (LOCAL_HOSTS.has(hostname) || input.allowRemote === 'true') return { allowed: true };
  return {
    allowed: false,
    message: `Recusado: a DATABASE_URL aponta para um banco que não é local. Para gravar nele de propósito, defina ${ALLOW_REMOTE_SEED_VAR}=true.`,
  };
}
