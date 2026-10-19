import { Module } from '@nestjs/common';
import { configPino } from 'src/config/plugins/pino.config';
import { betterAuthExceptionFilter } from './filters/better-auth/better-auth-exception.filter';
import { drizzleExceptionFilter } from './filters/drizzle/drizzle-exception.filter';
import { httpExceptionFilter } from './filters/http/http-exception.filter';
import { unexpectedExceptionFilter } from './filters/unexpected/unexpected-exception.filter';
import { rateLimit, throttler } from './guards/rate-limit.guard';
import { zodValidationPipe } from './pipes/zod-validation.pipe';

@Module({
  imports: [throttler, configPino],
  providers: [
    unexpectedExceptionFilter,
    betterAuthExceptionFilter,
    drizzleExceptionFilter,
    httpExceptionFilter,
    rateLimit,
    zodValidationPipe,
  ],
})
class CoreModule {}

export { CoreModule };
