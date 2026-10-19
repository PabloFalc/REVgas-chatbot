import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthorizedError } from 'src/core/erros/http.errors';
import { auth } from 'src/modules/auth/auth';
import { AuthGuard } from './auth.guard';

vi.mock('src/modules/auth/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('src/core/shared/request-headers', () => ({
  getRequestHeaders: vi.fn().mockReturnValue(new Headers()),
}));

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const asSession = (value: unknown): SessionResult => value as SessionResult;
const asContext = (value: unknown): ExecutionContext => value as ExecutionContext;
const asReflector = (value: unknown): Reflector => value as Reflector;

const mockSession = {
  user: { id: '1', name: 'User Test', email: 'test@test.com', emailVerified: true },
  session: { id: 'session-1', token: 'token-1' },
};

const createContext = (overrides: {
  isPublic?: boolean;
  isAnonymous?: boolean;
  allowUnverified?: boolean;
  request?: object;
}) => {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === 'isPublic') return overrides.isPublic ?? false;
      if (key === 'isAllowAnonymous') return overrides.isAnonymous ?? false;
      if (key === 'isAllowUnverified') return overrides.allowUnverified ?? false;
      return undefined;
    }),
  };

  const request = {
    url: '/protected',
    headers: {},
    session: undefined,
    ...overrides.request,
  };

  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue(request),
    }),
  };

  return { reflector, context, request };
};

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new AuthGuard(new Reflector());
  });

  describe('@Public', () => {
    it('deve retornar true sem verificar sessão', async () => {
      const { reflector, context } = createContext({ isPublic: true });
      guard = new AuthGuard(asReflector(reflector));

      const result = await guard.canActivate(asContext(context));

      expect(result).toBe(true);
      expect(auth.api.getSession).not.toHaveBeenCalled();
    });
  });

  describe('@AllowAnonymous', () => {
    it('deve retornar true sem sessão', async () => {
      const { reflector, context } = createContext({ isAnonymous: true });
      guard = new AuthGuard(asReflector(reflector));
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(asSession(null));

      const result = await guard.canActivate(asContext(context));

      expect(result).toBe(true);
    });

    it('deve injetar sessão no request quando logado', async () => {
      const { reflector, context, request } = createContext({ isAnonymous: true });
      guard = new AuthGuard(asReflector(reflector));
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(asSession(mockSession));

      await guard.canActivate(asContext(context));

      expect(request.session).toEqual(mockSession);
    });

    it('deve retornar true mesmo com sessão', async () => {
      const { reflector, context } = createContext({ isAnonymous: true });
      guard = new AuthGuard(asReflector(reflector));
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(asSession(mockSession));

      const result = await guard.canActivate(asContext(context));

      expect(result).toBe(true);
    });
  });

  describe('Rota protegida', () => {
    it('deve lançar UnauthorizedError sem sessão', async () => {
      const { reflector, context } = createContext({});
      guard = new AuthGuard(asReflector(reflector));
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(asSession(null));

      await expect(guard.canActivate(asContext(context))).rejects.toThrow(UnauthorizedError);
    });

    it('deve retornar true com sessão válida', async () => {
      const { reflector, context } = createContext({});
      guard = new AuthGuard(asReflector(reflector));
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(asSession(mockSession));

      const result = await guard.canActivate(asContext(context));

      expect(result).toBe(true);
    });

    it('deve injetar sessão no request', async () => {
      const { reflector, context, request } = createContext({});
      guard = new AuthGuard(asReflector(reflector));
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(asSession(mockSession));

      await guard.canActivate(asContext(context));

      expect(request.session).toEqual(mockSession);
    });
  });

  describe('Email verificado', () => {
    const unverifiedSession = {
      ...mockSession,
      user: { ...mockSession.user, emailVerified: false },
    };

    it('deve lançar ForbiddenError se email não verificado em rota normal', async () => {
      const { reflector, context } = createContext({});
      guard = new AuthGuard(asReflector(reflector));
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(asSession(unverifiedSession));

      await expect(guard.canActivate(asContext(context))).rejects.toThrow(ForbiddenError);
    });

    it('deve permitir email não verificado em rota @AllowUnverified', async () => {
      const { reflector, context } = createContext({ allowUnverified: true });
      guard = new AuthGuard(asReflector(reflector));
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(asSession(unverifiedSession));

      const result = await guard.canActivate(asContext(context));

      expect(result).toBe(true);
    });
  });
});
