import { type DestinationStream, destination } from 'pino';
import pinoPretty from 'pino-pretty';

const DEV_COLORS = 'message:white,trace:gray,debug:blue,info:green,warn:yellow,error:red,fatal:red';

export interface LogStreamOptions {
  pretty: boolean;
  file?: string;
}

function prettyStream(file?: string): DestinationStream {
  return pinoPretty({
    colorize: !file,
    translateTime: 'HH:MM:ss',
    customColors: DEV_COLORS,
    ignore: 'pid,hostname,req,res,responseTime,context',
    ...(file ? { destination: file, mkdir: true, append: true, sync: true } : {}),
    messageFormat: (log, messageKey, _levelLabel, { colors }) => {
      const record = log as Record<string, unknown>;
      const raw = record[messageKey];
      const msg = raw == null ? '' : String(raw);
      const context = typeof record.context === 'string' ? record.context : undefined;
      return context ? `${colors.cyan(`[${context}]`)} ${msg}` : msg;
    },
  });
}

export function createLogStream({ pretty, file }: LogStreamOptions): DestinationStream | undefined {
  if (pretty) return prettyStream(file);
  if (file) return destination({ dest: file, mkdir: true, append: true, sync: true });
  return undefined;
}
