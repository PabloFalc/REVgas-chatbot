import { describe, expect, it } from 'vitest';
import {
  assertSimulatorAllowed,
  ChatArgsError,
  DEFAULT_CHAT_ARGS,
  parseChatArgs,
  SIMULATOR_PHONE_NUMBER_ID,
  simulatorEnv,
} from './chat.args';

describe('parseChatArgs', () => {
  it('usa os padrões sem argumentos', () => {
    expect(parseChatArgs([])).toEqual(DEFAULT_CHAT_ARGS);
    expect(DEFAULT_CHAT_ARGS).toEqual({
      phone: '5586999990000',
      name: 'Cliente Simulador',
      revgas: 'fake',
      logFile: 'logs/chat.log',
      help: false,
    });
  });

  it('lê telefone, nome, modo do RevGás e arquivo de log', () => {
    expect(
      parseChatArgs([
        '--phone',
        '5586988887777',
        '--name',
        'Maria Souza',
        '--revgas',
        'hybrid',
        '--log-file',
        'tmp/x.log',
      ]),
    ).toEqual({
      phone: '5586988887777',
      name: 'Maria Souza',
      revgas: 'hybrid',
      logFile: 'tmp/x.log',
      help: false,
    });
  });

  it('aceita a forma --opcao=valor', () => {
    const args = parseChatArgs(['--phone=5586911112222', '--name=João']);
    expect(args.phone).toBe('5586911112222');
    expect(args.name).toBe('João');
  });

  it('liga a ajuda com --help ou -h', () => {
    expect(parseChatArgs(['--help']).help).toBe(true);
    expect(parseChatArgs(['-h']).help).toBe(true);
  });

  it('recusa telefone fora do formato wa_id', () => {
    expect(() => parseChatArgs(['--phone', '(86) 9999-0000'])).toThrow(ChatArgsError);
    expect(() => parseChatArgs(['--phone', '123'])).toThrow(/telefone/);
  });

  it('recusa modo do RevGás diferente de fake ou hybrid', () => {
    expect(() => parseChatArgs(['--revgas', 'live'])).toThrow(/fake.*hybrid/);
  });

  it('recusa nome vazio, opção sem valor e opção desconhecida', () => {
    expect(() => parseChatArgs(['--name', '  '])).toThrow(ChatArgsError);
    expect(() => parseChatArgs(['--phone'])).toThrow(/--phone/);
    expect(() => parseChatArgs(['--porta', '1'])).toThrow(/--porta/);
  });
});

describe('simulatorEnv', () => {
  it('força o WhatsApp fake, sem tokens, e o modo do RevGás escolhido', () => {
    const overrides = simulatorEnv({ ...DEFAULT_CHAT_ARGS, revgas: 'hybrid' });
    expect(overrides).toEqual({
      WHATSAPP_MODE: 'fake',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_APP_SECRET: '',
      WHATSAPP_VERIFY_TOKEN: '',
      WHATSAPP_PHONE_NUMBER_ID: SIMULATOR_PHONE_NUMBER_ID,
      REVGAS_MODE: 'hybrid',
      LOG_FILE: 'logs/chat.log',
    });
  });
});

describe('assertSimulatorAllowed', () => {
  it('recusa NODE_ENV=production', () => {
    expect(() => assertSimulatorAllowed('production')).toThrow(/produção/);
  });

  it('libera development, test e vazio', () => {
    expect(() => assertSimulatorAllowed('development')).not.toThrow();
    expect(() => assertSimulatorAllowed('test')).not.toThrow();
    expect(() => assertSimulatorAllowed(undefined)).not.toThrow();
  });
});
