import type { ArgumentMetadata } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BadRequestError } from '../erros/http.errors';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  class TestDto extends createZodDto(schema) {}

  const pipe = new ZodValidationPipe();

  const metadata = (metatype: unknown): ArgumentMetadata => ({
    type: 'body',
    metatype: metatype as never,
  });

  it('deve retornar os dados parseados quando forem validos', () => {
    const result = pipe.transform({ name: 'User Test', age: 25 }, metadata(TestDto));
    expect(result).toEqual({ name: 'User Test', age: 25 });
  });

  it('deve lancar BadRequestError quando os dados forem invalidos', () => {
    expect(() => pipe.transform({ name: 'User Test', age: '25' }, metadata(TestDto))).toThrow(
      BadRequestError,
    );
  });

  it('deve retornar o valor original quando o metatype nao for um ZodDto', () => {
    const value = { qualquer: 'valor' };
    expect(pipe.transform(value, metadata(String))).toBe(value);
    expect(pipe.transform(value, metadata(undefined))).toBe(value);
    expect(pipe.transform(value, metadata(class PlainClass {}))).toBe(value);
  });

  it('deve retornar valor transformado pelo schema', () => {
    class CoercingDto extends createZodDto(z.object({ age: z.coerce.number() })) {}
    const result = pipe.transform({ age: '42' }, metadata(CoercingDto));
    expect(result).toEqual({ age: 42 });
  });
});
