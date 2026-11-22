export function assertSafeForEvaluation(
  indexKeys: string[],
  baseSources: string[],
  nodeEnv: string,
): void {
  if (nodeEnv === 'production') {
    throw new Error(
      'rag:check não roda em produção: ele grava a base fictícia por cima do índice. Use um banco de desenvolvimento.',
    );
  }

  const allowed = new Set(baseSources);
  const foreign = [...new Set(indexKeys.map(key => key.split('#')[0]))].filter(
    source => !allowed.has(source),
  );
  if (foreign.length > 0) {
    throw new Error(
      `rag:check recusado: o banco já tem trechos de outra base (${foreign.join(', ')}). Rode só num banco de desenvolvimento com a base fictícia.`,
    );
  }
}
