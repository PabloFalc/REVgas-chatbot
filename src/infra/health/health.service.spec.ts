import { Test } from '@nestjs/testing';
import { HealthService } from './health.service';
import { HealthRegistryService } from './services/registry.service';

describe('HealthService', () => {
  let service: HealthService;
  let registry: HealthRegistryService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [HealthService, HealthRegistryService],
    }).compile();

    service = module.get(HealthService);
    registry = module.get(HealthRegistryService);
  });

  it('deve retornar status ok quando todos os checks passam', async () => {
    registry.register({
      name: 'cache',
      check: async () => ({ status: 'ok', responseTime: 5 }),
      onModuleInit: () => {},
    });

    const result = await service.check();

    expect(result.status).toBe('ok');
  });

  it('deve retornar unavailable quando cache falha', async () => {
    registry.register({
      name: 'cache',
      check: async () => ({ status: 'error', responseTime: 0, error: 'conn failed' }),
      onModuleInit: () => {},
    });

    await expect(service.check()).rejects.toMatchObject({ statusCode: 503 });
  });
  it('deve retornar degraded quando apenas database falha', async () => {
    registry.register({
      name: 'cache',
      check: async () => ({ status: 'ok', responseTime: 5 }),
      onModuleInit: () => {},
    });
    registry.register({
      name: 'database',
      check: async () => ({ status: 'error', error: 'conn failed' }),
      onModuleInit: () => {},
    });

    expect((await service.check()).status).toBe('degraded');
  });

  it('deve retornar unavailable quando cache não está registrado', async () => {
    registry.register({
      name: 'database',
      check: async () => ({ status: 'ok', responseTime: 5 }),
      onModuleInit: () => {},
    });

    await expect(service.check()).rejects.toMatchObject({ statusCode: 503 });
  });

  it('deve retornar unavailable quando o check de cache lança erro', async () => {
    registry.register({
      name: 'cache',
      check: async () => {
        throw new Error('conn failed');
      },
      onModuleInit: () => {},
    });

    await expect(service.check()).rejects.toMatchObject({ statusCode: 503 });
  });
});
