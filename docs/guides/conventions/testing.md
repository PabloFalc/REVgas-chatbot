# Como escrever testes

O projeto usa **Vitest** para testes unitários e e2e. As duas suítes têm configs separadas:

| Suíte | Config | Onde ficam | O que sobe |
| --- | --- | --- | --- |
| Unit | `vitest.config.ts` | `src/**/*.spec.ts` | nada externo (mocks/DI em memória) |
| E2e | `vitest.config.e2e.ts` | `tests/**/*.e2e.spec.ts` | app real + Postgres + Redis |

Comandos:

| Tarefa | Comando |
| --- | --- |
| Unit | `pnpm test` (não precisa de `.env` nem de infra) |
| E2e | `pnpm test:e2e` (precisa de infra: `pnpm docker:init` + `pnpm db:migrate`) |
| Infra local | `pnpm docker:init` / `pnpm docker:stop` |

> **Testar a conversa na mão, sem WhatsApp:** `pnpm chat` sobe o app e abre um chat no terminal,
> com o Chatwoot local mostrando a mesma conversa. Passo a passo em
> [chat-simulator.md](./chat-simulator.md).

## Testes unitários

Para classes com dependências, monte um módulo de teste com `Test.createTestingModule` e
resolva o que precisar pelo container. Mocke as dependências externas — unit não toca em banco
nem rede.

```ts
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
});
```

O arquivo fica ao lado da unidade testada (`*.spec.ts` dentro de `src/`).

## Testes e2e

> **Pré-requisitos do e2e:** Postgres e Redis no ar. O e2e usa um banco separado, derivado da
> `DATABASE_URL` com o sufixo `_e2e` (ex.: `revgas` vira `revgas_e2e`). O `globalSetup`
> (`tests/global-setup-e2e.ts`) cria o banco se não existir e aplica as migrations a cada execução,
> então o banco de desenvolvimento não recebe resíduo dos testes. O usuário da `DATABASE_URL` precisa
> poder criar bancos e a extensão `vector`. O unitário (`pnpm test`) não lê `.env`: o
> `vitest.config.ts` define o ambiente.

> O Postgres do e2e precisa ter o **pgvector** (imagem `pgvector/pgvector:pg17`, já no
> `docker-compose.yml`) e as migrations aplicadas (`pnpm db:migrate`). A suíte
> `tests/knowledge/` usa a tabela `knowledge_chunks`; veja
> [knowledge.md](../modules/knowledge.md#banco-local-pgvector).

E2e sobe o app **inteiro** (Fastify + DI + plugins) e faz requisições HTTP de verdade via
`supertest`. O app é criado pelo helper `createApp` (`tests/setup-e2e.ts`), que já roda
`setupPlugins` e fica em `NODE_ENV=test`.

```ts
export async function createApp(extraImports: (Type | DynamicModule)[] = []): Promise<NestFastifyApplication>;
```

`createApp` monta um módulo de teste `[AppModule, ...extraImports]`. Os `extraImports` servem para
montar módulos só de teste — ex.: `tests/core/drizzle-exception.e2e.spec.ts` passa um módulo com
rotas que disparam erros do banco.

`tests/app.e2e.spec.ts` cobre o app padrão: `GET /health` → `200`.

Em `NODE_ENV=test` os rate limits ficam relaxados (limite 9999) e o logger fica `silent` (suba com
`LOG_LEVEL=debug` ao depurar).

> O e2e roda no banco `<nome>_e2e`, não no de desenvolvimento. Mesmo assim a limpeza é
> **escopada por suíte** (apaga só os dados daquele teste), porque as suítes compartilham esse banco
> e nunca se usa `TRUNCATE` global.

Estrutura típica de uma suíte que grava no banco (ver `tests/metrics/bot-events.e2e.spec.ts`):

```ts
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { inArray } from 'drizzle-orm';
import { db } from 'src/infra/database/drizzle-client';
import { botEvents } from 'src/infra/database/schemas';
import supertest from 'supertest';
import { createApp } from '../setup-e2e';

describe('Métricas (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;
  const cycles: string[] = [];

  beforeAll(async () => {
    app = await createApp();
    request = supertest(app.getHttpServer());
  }, 30000);

  afterAll(async () => {
    if (cycles.length) await db.delete(botEvents).where(inArray(botEvents.cycleId, cycles));
    await app.close();
  }, 30000);
});
```

Pontos do padrão:

- A limpeza apaga **só** as linhas que a suíte criou (por uma coluna natural, como `cycle_id`).
- `request` é reaproveitado em toda a suíte.
- O `app.close()` no `afterAll` libera as conexões.

## Armadilhas (gotchas)

### Identificadores únicos por suíte

O e2e roda **em série** (`fileParallelism: false`), mas todas as suítes compartilham o mesmo
banco e o mesmo Redis. Como a limpeza é escopada (não global), **cada suíte deve usar ids,
telefones e ids de mensagem próprios** pra não colidir com outra.

### WhatsApp sempre simulado

`vitest.config.e2e.ts` força `REVGAS_MODE`, `VIACEP_MODE`, `LLM_MODE`, `WHATSAPP_MODE` e `CHATWOOT_MODE` para `fake`, independentemente do `.env` local.

`vitest.config.e2e.ts` define `WHATSAPP_MODE=fake` (e um app secret/verify token de teste), então
o e2e nunca envia mensagem real, mesmo com token no `.env`. Para ver o que o bot respondeu, pegue o
simulador com `app.get(WHATSAPP_CLIENT)` (é um `FakeWhatsappClient`: `sent`, `read`, `clear()`) e
assine o corpo com `signPayload` (`src/integrations/whatsapp/webhook/signature.ts`). Use ids de
mensagem únicos: ids repetidos são ignorados por 24h no Redis. O webhook responde 200 antes de
processar, então espere o envio com `vi.waitFor(() => expect(whatsapp.sent).toHaveLength(1))`. Exemplo:
`tests/conversation/whatsapp-webhook.e2e.spec.ts`.

### Chatwoot sempre simulado

O mesmo arquivo define `CHATWOOT_MODE=fake`, `CHATWOOT_INBOX_ID=1` e um `CHATWOOT_WEBHOOK_SECRET` de teste, então nenhum teste depende de um Chatwoot rodando. Pegue o simulador com `app.get(CHATWOOT_CLIENT)` para conferir contatos, conversas, mensagens e notas, e assine o corpo do webhook com `signChatwootPayload` (`src/integrations/chatwoot/webhook/signature.ts`). Use ids de mensagem únicos (dedup de 24h no Redis). Exemplo: `tests/conversation/chatwoot-webhook.e2e.spec.ts`.

## Checklist para uma suíte e2e nova

1. Crie `tests/<área>/<algo>.e2e.spec.ts`.
2. Use `createApp` + `supertest` no `beforeAll`.
3. Escolha ids, telefones e ids de mensagem **exclusivos** dessa suíte.
4. Apague no `afterAll` só as linhas que a suíte criou.
5. Feche o app com `app.close()` no `afterAll`.
6. Rode `pnpm docker:init`, `pnpm db:migrate` e depois `pnpm test:e2e`.
