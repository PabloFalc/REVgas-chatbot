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
      name: 'database',
      check: async () => ({ status: 'ok', responseTime: 5 }),
      onModuleInit: () => {},
    });

    const result = await service.check();

    expect(result.status).toBe('ok');
  });

  it('deve retornar unavailable quando database falha', async () => {
    registry.register({
      name: 'database',
      check: async () => ({ status: 'error', responseTime: 0, error: 'conn failed' }),
      onModuleInit: () => {},
    });

    await expect(service.check()).rejects.toThrow();
  });
});
