import { decideSeedTarget } from './metrics-seed-demo.target';

const REMOTE = 'postgresql://user:segredo@db.exemplo.com:5432/revgas';

describe('decideSeedTarget', () => {
  it.each([
    'postgresql://docker:docker@localhost:5432/revgas',
    'postgresql://docker:docker@127.0.0.1:5432/revgas',
    'postgresql://docker:docker@[::1]:5432/revgas',
    'postgresql://docker:docker@postgres:5432/revgas',
  ])('permite banco local %s', databaseUrl => {
    expect(
      decideSeedTarget({ nodeEnv: 'development', databaseUrl, allowRemote: undefined }),
    ).toEqual({ allowed: true });
  });

  it('recusa banco remoto sem liberação, sem expor URL nem credenciais', () => {
    const decision = decideSeedTarget({
      nodeEnv: undefined,
      databaseUrl: REMOTE,
      allowRemote: undefined,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.message).toContain('SEED_ALLOW_REMOTE=true');
    expect(decision.message).not.toContain('segredo');
    expect(decision.message).not.toContain('db.exemplo.com');
  });

  it('recusa remoto quando a liberação não é exatamente "true"', () => {
    expect(
      decideSeedTarget({ nodeEnv: undefined, databaseUrl: REMOTE, allowRemote: '1' }).allowed,
    ).toBe(false);
  });

  it('permite banco remoto com liberação explícita', () => {
    expect(
      decideSeedTarget({ nodeEnv: 'development', databaseUrl: REMOTE, allowRemote: 'true' }),
    ).toEqual({ allowed: true });
  });

  it('recusa em produção mesmo com host local e liberação', () => {
    const decision = decideSeedTarget({
      nodeEnv: 'production',
      databaseUrl: 'postgresql://docker:docker@localhost:5432/revgas',
      allowRemote: 'true',
    });
    expect(decision.allowed).toBe(false);
  });

  it.each(['não é url', '', undefined])('recusa URL inválida (%s)', databaseUrl => {
    const decision = decideSeedTarget({
      nodeEnv: undefined,
      databaseUrl,
      allowRemote: 'true',
    });
    expect(decision.allowed).toBe(false);
  });
});
