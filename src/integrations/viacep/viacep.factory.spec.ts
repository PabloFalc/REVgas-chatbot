import { describe, expect, it } from 'vitest';
import { FakeViacepClient } from './fake-viacep.client';
import { HttpViacepClient } from './http-viacep.client';
import { createViacepClient } from './viacep.factory';

const base = { baseUrl: 'https://viacep.com.br/ws', timeoutMs: 5000 };

describe('createViacepClient', () => {
  it('cria o fake', () => {
    expect(createViacepClient({ ...base, mode: 'fake' })).toBeInstanceOf(FakeViacepClient);
  });

  it('cria o cliente real', () => {
    expect(createViacepClient({ ...base, mode: 'live' })).toBeInstanceOf(HttpViacepClient);
  });
});
