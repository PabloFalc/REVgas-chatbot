export function parseTrustProxy(value: string | undefined): boolean | string {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;

  if (/^\d+$/.test(value)) {
    throw new Error(
      'TRUSTED_PROXY não aceita contagem de hops (o Fastify passou a ignorá-la). Informe o IP/CIDR do proxy.',
    );
  }

  return value;
}
