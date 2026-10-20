# Organização da infraestrutura — `/src/infra`

A camada `src/infra` concentra a integração com recursos externos — **cache** (Redis),
**database** (Drizzle/Postgres) e **health** (monitoramento). Cada subpasta é um módulo NestJS
com fronteiras explícitas (`imports`/`exports`).

> Serviços cross-cutting que não são infraestrutura de dados ficam em `src/core/services/` — hoje
> só o `EmailService` (Resend), em standby junto com a auth (ver
> [email-service.md](../guides/services/email-service.md)).

> Pela [especificação](../project/specs.md), `infra/` vai ganhar o estado da conversa (Redis com
> TTL) e as tabelas do chatbot (histórico, vendas, handoffs, métricas). Clientes de serviços
> externos (API RevGás, WhatsApp, LLM) **não** ficam aqui — vão para `src/integrations/`.

> Referência viva. A seção [Health checks](#health-checks--como-funcionam-e-como-adicionar-um-indicador)
> é um guia prático; a seção [Recomendações de evolução](#recomendações-de-evolução) lista
> melhorias mapeadas e o status de cada uma.

---

## Estrutura atual

```
src/infra/
├── infra.module.ts
├── cache/
│   ├── cache.module.ts
│   ├── cache-client.interface.ts
│   ├── redis.client.ts
│   ├── redis.service.ts
│   └── redis.health.ts          # indicador de health do Redis (name: "cache")
├── database/
│   ├── database.module.ts
│   ├── database-client.interface.ts
│   ├── drizzle-client.ts
│   ├── drizzle.service.ts
│   ├── drizzle.health.ts        # indicador de health do Postgres (name: "database")
│   ├── helpers/
│   │   └── soft-delete.ts       # notDeleted() para tabelas com deleted_at
│   └── schemas/
│       ├── index.ts
│       ├── better-auth/
│       │   ├── accounts.table.ts
│       │   ├── sessions.table.ts
│       │   ├── users.table.ts
│       │   └── verifications.table.ts
│       └── shared/
│           └── timestamps.ts
└── health/
    ├── health.module.ts
    ├── health.controller.ts     # GET /health (público, com throttle)
    ├── health.service.ts        # agrega os indicadores e calcula o status global
    ├── health.public.ts         # poda o detalhe (checks) em produção
    ├── contracts/
    │   └── health.interface.ts  # IHealthChecks (contrato de um indicador)
    ├── services/
    │   ├── memory.health.ts     # indicador de memória (name: "Memory")
    │   └── registry.service.ts  # HealthRegistryService (registro dos indicadores)
    ├── schemas/
    │   └── health.schemas.ts
    └── docs/
        └── health.doc.ts
```

---

## Pontos fortes

- Separação clara entre as responsabilidades de `cache`, `database` e `health`
- Design orientado a interfaces (`ICacheClient`, `IDatabaseClient`) permite trocar implementações
- O padrão de registry dos health checks é extensível — novos indicadores se registram sozinhos,
  sem tocar no código existente (ver abaixo)
- Schemas agrupados por domínio (`better-auth/`, `shared/`)
- Fronteiras de módulo NestJS bem definidas, com `imports`/`exports` explícitos

---

## Health checks — como funcionam e como adicionar um indicador

O `GET /health` reúne, sob demanda, o estado de cada subsistema. O design é **plugável**: cada
indicador se **auto-registra** num registry compartilhado, e o `HealthService` apenas itera o que
estiver registrado. Adicionar um novo recurso ao health check **não** exige tocar no
`HealthService` nem no controller.

### As peças

| Peça | Papel |
| --- | --- |
| `IHealthChecks` (`contracts/health.interface.ts`) | Contrato de um indicador: `name: string`, `check()` e `onModuleInit()` (onde ele se registra). |
| `HealthRegistryService` (`services/registry.service.ts`) | Guarda a lista de indicadores (`register()` / `getChecks()`). É **exportado** pelo `HealthModule`. |
| Indicadores | `MemoryHealthService` (em `health/`), `RedisHealthService` (em `cache/`) e `DrizzleHealthService` (em `database/`). Cada um implementa `IHealthChecks`. |
| `HealthService` (`health.service.ts`) | Roda todos os indicadores (`Promise.allSettled`), monta o mapa `checks` e calcula o **status global**. |
| `publicHealth` (`health.public.ts`) | Em produção, remove o `checks` da resposta (só `status`/`timestamp`/`uptime`). |
| `HealthController` | `GET /health` — `@Public()`, `@Throttle(HEALTH_THROTTLE)` (120/min), retorna `publicHealth(result)`. |

### O fluxo de uma chamada a `/health`

```
1. cada indicador, no onModuleInit, chamou registry.register(this)   (uma vez, no boot)
2. GET /health → HealthService.check()
3. roda check() de todos os indicadores em paralelo (Promise.allSettled)
4. monta checks = { [name]: { status, responseTime, details? , error? } }
5. status global:
     - check "database" != ok        → "unavailable"  (lança 503, corpo podado)
     - algum outro check != ok        → "degraded"
     - todos ok                       → "ok"
6. publicHealth(result): em produção remove o objeto "checks"
```

O `database` é o único indicador **crítico** (derruba o status para `unavailable`/503); os demais
apenas marcam `degraded`. Essa regra está no `HealthService.check()` — para tornar outro recurso
crítico, ajuste ali.

### Adicionando um indicador novo

Exemplo: um indicador para um serviço externo qualquer.

**1. Crie o indicador** implementando `IHealthChecks`. O `check()` deve ser **resiliente** (com
timeout) para não travar o `/health`, e retornar um `HealthCheckResult`
(`status: 'ok' | 'warning' | 'error'`, `responseTime`, `details?`/`error?`):

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { IHealthChecks } from '../health/contracts/health.interface';
import type { HealthCheckResult } from '../health/schemas/health.schemas';
import { HealthRegistryService } from '../health/services/registry.service';

@Injectable()
export class StorageHealthService implements IHealthChecks {
  readonly name = 'storage';

  constructor(@Inject(HealthRegistryService) private readonly registry: HealthRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // ...ping no recurso, idealmente com timeout (ver redis.health.ts)...
      return { status: 'ok', responseTime: Date.now() - start };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'storage check failed';
      return { status: 'error', responseTime: Date.now() - start, error: message };
    }
  }
}
```

**2. Registre como provider** no módulo do recurso e garanta que esse módulo **importe**
`HealthModule` (é assim que `cache/` e `database/` enxergam o `HealthRegistryService` mesmo
ficando fora de `health/`):

```ts
@Module({
  imports: [HealthModule],
  providers: [StorageHealthService],
})
export class StorageModule {}
```

**3. Pronto.** No boot, o `onModuleInit` registra o indicador; o `/health` passa a incluí-lo
automaticamente em `checks.storage`. Se ele deve ser **crítico** (derrubar o serviço quando cair),
ajuste a regra de status no `HealthService.check()`.

> Veja `cache/redis.health.ts` como referência de um `check()` com timeout (usa `Promise.race`) e
> `database/drizzle.health.ts` para um ping de banco. `health/services/memory.health.ts` é um
> indicador puramente local (sem I/O).

---

## Recomendações de evolução

Melhorias mapeadas para a camada. São **opcionais** e ainda **não aplicadas** — ficam aqui como
norte de evolução.

### 1 — Schemas de domínio dentro de `infra/`

`database/schemas/` concentra todas as tabelas, inclusive as que são definições de domínio. A
[especificação](../project/specs.md) **adota** esse arranjo (tabelas Drizzle em
`infra/database/schema`, schemas Zod no módulo que os usa), então mover os schemas para fora de
`infra/` só faz sentido se o grupo revisar essa decisão.

### 2 — Nome `health/services/` é genérico

A pasta `health/services/` contém `memory.health.ts` e `registry.service.ts`. O `memory.health.ts`
é um **indicador**, não um serviço genérico. Renomear para `health/indicators/` (e
`memory.indicator.ts`) alinharia com a convenção do TerminusModule do NestJS. A convenção atual de
nome é `*.health.ts` (ver `redis.health.ts`, `drizzle.health.ts`).

### 3 — Sem abstração de logging

O Pino é configurado em `src/config/plugins/pino.config.ts`, mas não há um módulo de logging na
infra. Um `infra/logging/` com um `logger.service.ts` (wrapper fino sobre o Pino, injetando
`requestId`) padronizaria o logging e habilitaria rastreamento distribuído.

### 4 — Sem infraestrutura de fila

Não há fila. No chatbot, o processamento do webhook do WhatsApp (IA, chamadas à API RevGás) e
envios assíncronos (ex.: notificações) podem precisar sair do ciclo da requisição — o provedor
espera resposta rápida do webhook. Uma fila (`infra/queue/` com `bullmq` + `@nestjs/bullmq`)
resolveria isso.

### Prioridade

| Prioridade | Mudança | Esforço | Status |
|----------|--------|--------|--------|
| 1 | Mover `schemas/` para fora de `infra/database/` | Médio | ⬜ não aplicado (specs mantém em `infra/`) |
| 2 | Renomear `health/services/` para `health/indicators/` | Baixo | ⬜ não aplicado |
| 3 | Criar o módulo `infra/logging/` | Baixo | ⬜ não aplicado |
| 4 | Criar `infra/queue/` para processamento assíncrono | Médio | ⬜ não aplicado |
