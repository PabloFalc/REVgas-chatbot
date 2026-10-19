import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { env } from '../../config/env';
import { allowAllOrigins, allowedOrigins } from '../../config/origins';
import { EmailService } from '../../core/services/email/email.service';
import { resend } from '../../core/services/email/resend.client';
import { redis } from '../../infra/cache/redis.client';
import { db } from '../../infra/database/drizzle-client';

export const BETTER_AUTH_TOKEN = 'BETTER_AUTH_TOKEN';

const emailService = new EmailService(resend);

function buildNativeVerifyUrl(originalUrl: string, token: string): string {
  const params = new URLSearchParams({ token });
  const callbackURL = new URL(originalUrl).searchParams.get('callbackURL');
  if (callbackURL && callbackURL !== '/') {
    params.set('callbackURL', callbackURL);
  }
  return `${env.BETTER_AUTH_URL}/auth/email/verify?${params.toString()}`;
}

function buildFrontendResetUrl(originalUrl: string, token: string): string {
  const callbackURL = new URL(originalUrl).searchParams.get('callbackURL');
  const resetPage = new URL(callbackURL ?? env.BETTER_AUTH_URL);
  resetPage.searchParams.set('token', token);
  return resetPage.toString();
}

export const trustedOrigins = allowAllOrigins ? ['*'] : allowedOrigins;

export function isTrustedCallbackURL(callbackURL: string): boolean {
  if (allowAllOrigins) return true;
  try {
    return allowedOrigins.includes(new URL(callbackURL).origin);
  } catch {
    return false;
  }
}

export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url, token }) => {
      const link = buildFrontendResetUrl(url, token);
      await emailService.sendPasswordReset({ to: user.email, url: link, userName: user.name });
    },
  },

  emailVerification: {
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user, url, token }) => {
      const link = buildNativeVerifyUrl(url, token);
      await emailService.sendVerificationEmail({ to: user.email, url: link, userName: user.name });
    },
  },

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins,

  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    camelCase: false,
  }),
  secondaryStorage: {
    get: key => redis().get(key),
    getAndDelete: key => redis().getdel(key),
    increment: async (key, ttl) =>
      Number(
        await redis().eval(
          "local v = redis.call('INCR', KEYS[1]) if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return v",
          1,
          key,
          ttl,
        ),
      ),
    set: async (key, value, ttl) => {
      if (ttl) await redis().set(key, value, 'EX', ttl);
      else await redis().set(key, value);
    },
    delete: async key => {
      await redis().del(key);
    },
  },
  session: {
    storeSessionInDatabase: true,
    cookieCache: {
      enabled: false,
    },
    expiresIn: 60 * 60 * 24 * 7,
  },
  user: {
    additionalFields: {
      userName: {
        required: true,
        unique: true,
        type: 'string',
      },
    },
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, url, token }) => {
        const link = buildNativeVerifyUrl(url, token);
        await emailService.sendVerificationEmail({
          to: user.email,
          url: link,
          userName: user.name,
        });
      },
    },
    deleteUser: {
      enabled: true,
    },
  },
  advanced: {
    database: {
      generateId: false,
    },
  },
  plugins: [bearer()],
});

export type BetterAuth = typeof auth;
export type Session = typeof auth.$Infer.Session;

export const betterAuthInstance = {
  provide: BETTER_AUTH_TOKEN,
  useValue: auth,
};
