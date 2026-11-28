import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildEnv,
  describeEntries,
  formatEnv,
  parseAssignments,
  parseSets,
  parseTemplate,
} from './render-prod-env.lib.mjs';

const USAGE =
  'uso: render-prod-env.mjs <arquivo-fonte> --out <saida> [--template <modelo>] [--set CHAVE=valor]...';

function parseArgs(argv) {
  const args = { sets: [], source: undefined, out: undefined, template: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--template') args.template = argv[++i];
    else if (arg === '--set') args.sets.push(argv[++i] ?? '');
    else if (!args.source) args.source = arg;
    else throw new Error(USAGE);
  }
  if (!args.source || !args.out) throw new Error(USAGE);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const templatePath =
    args.template ?? fileURLToPath(new URL('../../docker/prod.env.example', import.meta.url));
  const template = parseTemplate(readFileSync(templatePath, 'utf8'));
  const source = parseAssignments(readFileSync(args.source, 'utf8'));
  const existing = existsSync(args.out)
    ? parseAssignments(readFileSync(args.out, 'utf8'))
    : new Map();

  const { entries, warnings, missing } = buildEnv({
    template,
    source,
    existing,
    sets: parseSets(args.sets),
  });

  for (const warning of warnings) console.error(`aviso: ${warning}`);
  for (const line of describeEntries(entries)) console.log(line);

  if (missing.length > 0) {
    console.error(`obrigatórias vazias: ${missing.join(', ')}`);
    process.exit(1);
  }

  writeFileSync(args.out, formatEnv(entries), { mode: 0o600 });
  chmodSync(args.out, 0o600);
  console.log(`gravado em ${args.out} (permissão 600)`);
}

try {
  main();
} catch (error) {
  console.error(`falha: ${error.message}`);
  process.exit(1);
}
