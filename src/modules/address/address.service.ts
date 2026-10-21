import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { env } from '../../config/env';
import { LlmError } from '../../core/erros/llm/llm.errors';
import { ViacepError } from '../../core/erros/viacep/viacep.errors';
import { LLM_CLIENT, type LlmClient } from '../../integrations/llm/llm.client';
import { VIACEP_CLIENT, type ViacepClient } from '../../integrations/viacep/viacep.client';
import type { AddressDraft, AddressField } from './contracts/address.types';

const CPF_PATTERN = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;

const FIELD_ORDER: AddressField[] = ['street', 'number', 'neighborhood'];

const SYSTEM_PROMPT = [
  'Você extrai dados de um endereço brasileiro escrito livremente por um cliente.',
  'Extraia rua, número, bairro, cidade, UF, CEP, complemento e ponto de referência.',
  'Nunca invente informação: se um campo não aparecer no texto, devolva null.',
  'Responda somente com o objeto pedido.',
].join(' ');

const parsedAddressSchema = z.object({
  street: z.string().nullable(),
  number: z.string().nullable(),
  neighborhood: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  complement: z.string().nullable(),
  landmark: z.string().nullable(),
});

type ParsedAddress = z.infer<typeof parsedAddressSchema>;

function presentFields(parsed: ParsedAddress): AddressDraft {
  const draft: AddressDraft = {};
  for (const [key, value] of Object.entries(parsed) as [keyof ParsedAddress, string | null][]) {
    const trimmed = value?.trim();
    if (trimmed) {
      draft[key] = trimmed;
    }
  }
  return draft;
}

@Injectable()
export class AddressService {
  constructor(
    @Inject(VIACEP_CLIENT) private readonly viacep: ViacepClient,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  async fromCep(cep: string): Promise<AddressDraft | null> {
    const found = await this.viacep.lookup(cep);
    if (!found) {
      return null;
    }
    return {
      postalCode: found.postalCode,
      street: found.street,
      neighborhood: found.neighborhood,
      city: found.city,
      state: found.state,
    };
  }

  async fromText(text: string): Promise<AddressDraft | null> {
    const parsed = await this.parse(text);
    if (!parsed) {
      return null;
    }
    const draft = presentFields(parsed);
    if (draft.postalCode) {
      const digits = draft.postalCode.replace(/\D/g, '');
      if (digits) {
        draft.postalCode = digits;
      } else {
        delete draft.postalCode;
      }
    }
    const completed = await this.completeFromCep(draft);
    return {
      ...completed,
      city: completed.city ?? env.STORE_CITY,
      state: completed.state ?? env.STORE_STATE,
    };
  }

  missingField(draft: AddressDraft): AddressField | null {
    return FIELD_ORDER.find(field => !draft[field]) ?? null;
  }

  private async parse(text: string): Promise<ParsedAddress | null> {
    try {
      const { object } = await this.llm.generateObject({
        operation: 'parse-address',
        schemaName: 'address',
        schema: parsedAddressSchema,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.replace(CPF_PATTERN, '') },
        ],
      });
      return object;
    } catch (error) {
      if (error instanceof LlmError) {
        return null;
      }
      throw error;
    }
  }

  private async completeFromCep(draft: AddressDraft): Promise<AddressDraft> {
    if (!draft.postalCode) {
      return draft;
    }
    try {
      const found = await this.fromCep(draft.postalCode);
      return found ? { ...found, ...draft } : draft;
    } catch (error) {
      if (error instanceof ViacepError) {
        return draft;
      }
      throw error;
    }
  }
}
