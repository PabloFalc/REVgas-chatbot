import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS, redactUrl } from './pino.config';

describe('redactUrl', () => {
  it('esconde o verify token do webhook do WhatsApp', () => {
    expect(
      redactUrl('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=segredo&hub.challenge=1'),
    ).toBe('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=[REDACTED]&hub.challenge=1');
    expect(redactUrl('/x?hub.verify_token=segredo')).toBe('/x?hub.verify_token=[REDACTED]');
  });

  it('mantém as demais URLs', () => {
    expect(redactUrl('/health')).toBe('/health');
    expect(redactUrl(undefined)).toBe('');
  });
});

describe('REDACT_PATHS', () => {
  it('redige CPF no objeto e nos campos filhos em todos os ambientes', () => {
    const linhas: string[] = [];
    const logger = pino(
      { redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
      { write: (linha: string) => linhas.push(linha) },
    );

    logger.info({ cpf: '11111111111', cliente: { cpf: '22222222222', nome: 'Ana' } });

    const registro = JSON.parse(linhas[0]);
    expect(registro.cpf).toBe('[REDACTED]');
    expect(registro.cliente.cpf).toBe('[REDACTED]');
    expect(registro.cliente.nome).toBe('Ana');
  });
});
