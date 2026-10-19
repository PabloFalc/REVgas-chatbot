import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map, type Observable } from 'rxjs';
import { ZodError, type ZodType } from 'zod';
import { BadRequestError } from '../erros/http.errors';

@Injectable()
export class ZodResponseInterceptor implements NestInterceptor {
  constructor(private readonly schemas: Record<number, ZodType<unknown>>) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const ctx = context.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    return next.handle().pipe(
      map((data: unknown) => {
        const status = reply.statusCode;
        const schema = this.schemas[status];

        if (!schema) return data;

        try {
          return schema.parse(data);
        } catch (err: unknown) {
          if (err instanceof ZodError) {
            throw new BadRequestError({
              message: `Response for status ${status} does not match schema`,
              details: err.issues,
            });
          }

          throw err;
        }
      }),
    );
  }
}
