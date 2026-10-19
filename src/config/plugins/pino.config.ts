import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger, LoggerModule, PinoLogger } from 'nestjs-pino';
import { type LoggerOptions, stdSerializers } from 'pino';
import pinoPretty from 'pino-pretty';
import { env } from 'src/config/env';
import type { AppSetup } from '../setup';

const isDev = env.NODE_ENV === 'development';
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

const level = env.LOG_LEVEL ?? (isTest ? 'silent' : isDev ? 'debug' : 'info');

type PinoRequest = IncomingMessage & { id?: string | number };

const SECRET_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'authorization',
  '*.authorization',
  '*.cookie',
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
];

const PII_REDACT_PATHS = ['email', '*.email', 'to', '*.to'];

const REDACT_PATHS = isProd ? [...SECRET_REDACT_PATHS, ...PII_REDACT_PATHS] : SECRET_REDACT_PATHS;

const SILENCED_ROUTES = new Set(['/health']);

const DEV_COLORS = 'message:white,trace:gray,debug:blue,info:green,warn:yellow,error:red,fatal:red';

export const pino: AppSetup = app => {
  app.useLogger(app.get(Logger));
};

function createDevStream() {
  return pinoPretty({
    colorize: true,
    translateTime: 'HH:MM:ss',
    customColors: DEV_COLORS,
    ignore: 'pid,hostname,req,res,responseTime,context',
    messageFormat: (log, messageKey, _levelLabel, { colors }) => {
      const record = log as Record<string, unknown>;
      const raw = record[messageKey];
      const msg = raw == null ? '' : String(raw);
      const context = typeof record.context === 'string' ? record.context : undefined;
      return context ? `${colors.cyan(`[${context}]`)} ${msg}` : msg;
    },
  });
}

const baseOptions: LoggerOptions = {
  level,
  base: isDev
    ? undefined
    : {
        service: process.env.npm_package_name ?? 'api',
        env: env.NODE_ENV,
      },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  serializers: {
    err: stdSerializers.err,
    req: (req: PinoRequest) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
  },
};

const httpOptions = {
  ...baseOptions,
  customLogLevel: (req: IncomingMessage, res: ServerResponse, err?: Error) => {
    const pinoReq = req as PinoRequest;
    const path = (pinoReq.url ?? '').split('?')[0];
    if (SILENCED_ROUTES.has(path)) return 'silent';
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req: IncomingMessage, res: ServerResponse, responseTime: number) => {
    const pinoReq = req as PinoRequest;
    return `(${pinoReq.id}) ${pinoReq.method} ${pinoReq.url} ${res.statusCode} ${Math.round(responseTime)}ms`;
  },
  customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) => {
    const pinoReq = req as PinoRequest;
    return `(${pinoReq.id}) ${pinoReq.method} ${pinoReq.url} ${res.statusCode} - ${err?.message ?? 'error'}`;
  },
};

export const configPino = LoggerModule.forRoot({
  pinoHttp: isDev ? [httpOptions, createDevStream()] : httpOptions,
});

export function createLogger(context: string): PinoLogger {
  const logger = new PinoLogger({
    pinoHttp: isDev ? [httpOptions, createDevStream()] : httpOptions,
  });
  logger.setContext(context);
  return logger;
}
