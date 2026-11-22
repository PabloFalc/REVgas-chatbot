import { DrizzleQueryError } from 'drizzle-orm/errors';

export interface IngestArgs {
  dir: string | undefined;
  force: boolean;
}

const FORCE_FLAG = '--force';
const QUERY_PREFIX = 'Failed query:';

export function parseIngestArgs(argv: string[]): IngestArgs {
  return {
    dir: argv.find(arg => !arg.startsWith('--')),
    force: argv.includes(FORCE_FLAG),
  };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0].trim();
}

function queryFailure(error: Error): string {
  const cause = error.cause instanceof Error ? error.cause : error;
  const code = (cause as { code?: unknown }).code;
  const detail = typeof code === 'string' ? `${cause.name} ${code}` : cause.name;
  return `Falha na consulta ao banco (${detail})`;
}

export function formatCliError(error: unknown): string {
  if (!(error instanceof Error)) return firstLine(String(error));
  const line = firstLine(error.message);
  if (error instanceof DrizzleQueryError || line.startsWith(QUERY_PREFIX)) {
    return queryFailure(error);
  }
  return line || error.name;
}
