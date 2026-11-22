import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogStream } from './log-stream';

describe('createLogStream', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'log-stream-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sem arquivo e sem pretty usa a saída padrão do pino', () => {
    expect(createLogStream({ pretty: false })).toBeUndefined();
  });

  it('com arquivo e pretty grava texto legível sem cores, criando a pasta', async () => {
    const file = join(dir, 'logs', 'chat.log');
    pino({}, createLogStream({ pretty: true, file })).info({ context: 'Teste' }, 'olá arquivo');

    const content = await readFile(file, 'utf8');
    expect(content).toContain('[Teste] olá arquivo');
    expect(content).not.toContain('\u001b[');
  });

  it('com arquivo e sem pretty grava JSON', async () => {
    const file = join(dir, 'app.log');
    pino({}, createLogStream({ pretty: false, file })).info('olá json');

    const [line] = (await readFile(file, 'utf8')).trim().split('\n');
    expect(JSON.parse(line)).toMatchObject({ msg: 'olá json' });
  });

  it('acrescenta ao arquivo existente', async () => {
    const file = join(dir, 'app.log');
    pino({}, createLogStream({ pretty: false, file })).info('primeira');
    pino({}, createLogStream({ pretty: false, file })).info('segunda');

    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
