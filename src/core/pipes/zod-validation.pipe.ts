import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { isZodDto } from 'nestjs-zod/dto';
import { ZodError } from 'zod';
import { BadRequestError } from '../erros/http.errors';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    const { metatype } = metadata;

    if (!isZodDto(metatype)) return value;

    try {
      return metatype.schema.parse(value);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        throw new BadRequestError({
          message: 'Validation Error',
          details: error.issues,
        });
      }
    }
  }
}

export const zodValidationPipe = {
  provide: APP_PIPE,
  useClass: ZodValidationPipe,
};
