export interface SeedDemoArgs {
  clear: boolean;
}

export function parseSeedDemoArgs(argv: string[]): SeedDemoArgs {
  const unknown = argv.find(arg => arg !== '--clear');
  if (unknown) throw new Error(`Argumento desconhecido: ${unknown}. Use apenas --clear.`);
  return { clear: argv.includes('--clear') };
}
