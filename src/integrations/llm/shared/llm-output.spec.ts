import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmInvalidOutputError, LlmRejectedError } from '../../../core/erros/llm/llm.errors';
import { parseLlmObject, toResponseJsonSchema, validateLlmObject } from './llm-output';

function catchError(fn: () => unknown): LlmInvalidOutputError {
  try {
    fn();
  } catch (error) {
    if (error instanceof LlmInvalidOutputError) {
      return error;
    }
    throw error;
  }
  throw new Error('não lançou');
}

describe('parseLlmObject', () => {
  const schema = z.object({
    quantidade: z.number().int(),
    pagamento: z.enum(['pix', 'dinheiro']).optional(),
  });

  it('aceita JSON válido', () => {
    expect(parseLlmObject('{"quantidade":2}', schema)).toEqual({ quantidade: 2 });
  });

  it('remove cerca markdown ```json', () => {
    expect(parseLlmObject('```json\n{"quantidade":2}\n```', schema)).toEqual({ quantidade: 2 });
  });

  it('remove cerca markdown ``` sem linguagem e espaços', () => {
    expect(parseLlmObject('  ```\n{"quantidade":3}\n```  ', schema)).toEqual({ quantidade: 3 });
  });

  it('JSON inválido → LlmInvalidOutputError', () => {
    const error = catchError(() => parseLlmObject('não é json', schema));
    expect(error.issues).toEqual([{ path: '', message: 'JSON inválido' }]);
  });

  it('fora do schema → issues com caminho, sem o valor recebido', () => {
    const error = catchError(() =>
      parseLlmObject('{"quantidade":"duas","pagamento":"cartão-secreto"}', schema),
    );
    expect(error.issues.map(i => i.path)).toEqual(['quantidade', 'pagamento']);
    expect(JSON.stringify(error.issues)).not.toContain('cartão-secreto');
  });
});

describe('validateLlmObject', () => {
  it('devolve o valor validado', () => {
    expect(validateLlmObject({ a: 1 }, z.object({ a: z.number() }))).toEqual({ a: 1 });
  });

  it('lança LlmInvalidOutputError para valor fora do schema', () => {
    const error = catchError(() => validateLlmObject({ a: 'x' }, z.object({ a: z.number() })));
    expect(error.issues.map(i => i.path)).toEqual(['a']);
  });
});

describe('toResponseJsonSchema', () => {
  it('converte o schema e remove $schema', () => {
    const result = toResponseJsonSchema(z.object({ quantidade: z.number() }));
    expect(result).not.toHaveProperty('$schema');
    expect(result).toMatchObject({ type: 'object' });
  });

  it('schema com transform → LlmRejectedError sem detalhes', () => {
    const schema = z.object({ n: z.string().transform(value => value.length) });
    expect(() => toResponseJsonSchema(schema)).toThrow(LlmRejectedError);
    expect(() => toResponseJsonSchema(schema)).toThrow('Schema não representável em JSON Schema');
  });

  it('z.date() → LlmRejectedError', () => {
    expect(() => toResponseJsonSchema(z.object({ quando: z.date() }))).toThrow(LlmRejectedError);
  });
});
