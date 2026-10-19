# Uso do `@ApiDoc`

O `@ApiDoc` centraliza a documentação e parte do contrato de uma rota HTTP num único decorator.
Ele gera o Swagger/Scalar da rota e, quando há respostas declaradas, valida o payload de saída
com Zod.

Use-o em métodos de controller, junto com os decorators de rota do NestJS (`@Get`, `@Post`,
`@Patch`, `@Delete`).

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';

@Controller('/health')
export class HealthController {
  @ApiDoc({
    summary: 'Verifica a saúde da API',
    statusCode: 200,
    response: { 200: healthSchema },
  })
  @Get('/')
  async check() {
    return this.service.check();
  }
}
```

## Onde ele fica

```ts
import { ApiDoc, type ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
```

Arquivo: `src/core/decorators/api-doc/api-doc.decorator.ts`. É **autocontido** — toda a lógica
(naming, criação de DTO, montagem dos decorators) vive nesse arquivo, sem helpers externos.

## Assinatura

```ts
export type ApiDocParams = {
  summary?: string;
  description?: string;
  body?: ZodType | ZodDto;
  query?: ZodType | ZodDto;
  param?: Record<string, ZodType | ZodDto | 'string' | 'number' | 'boolean'>;

  security?: {
    bearer?: boolean;
  };

  response?: Record<number, ZodType | ZodDto>;
  statusCode?: number;
};
```

Todos os campos de schema aceitam **schema Zod puro** ou **classe `createZodDto`** — e, como
explicado abaixo, os dois produzem o **mesmo** resultado na documentação.

## Como ele funciona por dentro

O `@ApiDoc` tem três partes pequenas:

### 1. Decorator adiado (`ApiDoc`)

```ts
export function ApiDoc(props: ApiDocParams): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const route = routeName(target, propertyKey);
    const decorators = buildApiDocDecorators(props, route);
    return applyDecorators(...decorators)(target, propertyKey, descriptor);
  };
}
```

`ApiDoc` **não** monta os decorators na hora em que você escreve `@ApiDoc({...})`. Ele devolve uma
função que só roda quando o decorator é aplicado ao método — e aí o NestJS entrega o `target` (a
classe do controller) e o `propertyKey` (o nome do método). É isso que permite nomear os models
pela rota.

### 2. Nome da rota (`routeName`)

```ts
function routeName(target, propertyKey) {
  const controller = target.constructor.name.replace(/Controller$/, '');
  const method = String(propertyKey);
  return `${controller}${method.charAt(0).toUpperCase()}${method.slice(1)}`;
}
```

Junta a classe (sem o sufixo `Controller`) com o método em PascalCase:
`EmailAuthController.signUp` → `EmailAuthSignUp`. É confiável: a classe já existe quando seus
métodos são decorados, então não depende da ordem dos decorators nem do metadata do `@Controller`.

### 3. Criação do model (`namedDto`)

```ts
function namedDto(schema, name) {
  const zodSchema = (isZodDto(schema) ? schema.schema : schema) as ZodType;
  const dto = createZodDto(zodSchema);
  Object.defineProperty(dto, 'name', {
    value: `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    writable: false,
  });
  return dto;
}
```

Recebe um schema (ou DTO) e o nome derivado da rota. **Sempre** cria um DTO novo a partir do
schema Zod e fixa o nome. Se você passar uma classe `createZodDto`, ele extrai o schema dela
(`.schema`) e cria um model novo — **sem renomear a classe original** (importante: a classe que
valida no controller continua intacta).

> O resultado disso é a regra central: **schema Zod puro e classe `createZodDto` geram o mesmo
> model**, com o nome vindo da rota.

### Montagem (`buildApiDocDecorators`)

Com o `route` em mãos, monta a lista de decorators do NestJS/Swagger:

- `ApiOperation` (summary + description);
- `ApiParam` para cada `param`;
- `ApiBody` para `body`;
- `ApiQuery` para `query`;
- `ApiBearerAuth('bearer')` quando `security.bearer`;
- quando há `response`: registra o `ZodResponseInterceptor` (mapa status → schema) e um
  `ApiResponse` por status;
- `HttpCode(statusCode ?? 200)`.

## Nome dos models (padrão único)

O nome de cada model no Swagger é **sempre** `${rota}${sufixo}`:

| Campo | Sufixo | Exemplo |
| --- | --- | --- |
| `body` | `Body` | `EmailAuthSignUpBody` |
| `query` | `Query` | `OrderListQuery` |
| `param` (com schema/DTO) | `<chave>Param` | `OrderGetidParam` (método `get`, chave `id`) |
| `response` | `<status>` | `EmailAuthSignUp201` |

E, de novo, **tanto faz passar schema raw ou `createZodDto`** — o nome é o mesmo:

```ts
// body: createZodDto                 // body: schema Zod puro
body: CreateOrderDto     ===    body: createOrderSchema
// ambos viram o model: OrderCreateBody
```

Vantagens desse modelo:

- **Nome legível e previsível**, derivado direto da rota.
- **Sem colisão:** cada rota tem o seu próprio model; dois schemas de forma igual em rotas
  diferentes nunca compartilham model.
- **Consistência:** o mesmo contrato documentado igual, venha como schema ou como DTO.

## ⚠️ Documentar ≠ validar

Este é o ponto mais importante. O `@ApiDoc` **documenta**. Quem **valida** são dois mecanismos
separados:

| O quê | Quem valida | Condição |
| --- | --- | --- |
| Entrada (`body`/`query`/`param`) | `ZodValidationPipe` global | o **parâmetro do controller** é uma classe `createZodDto` |
| Saída (`response`) | `ZodResponseInterceptor` (injetado por rota pelo `@ApiDoc`) | há `response` declarado para aquele status |

O pipe global (`src/core/pipes/zod-validation.pipe.ts`) só valida quando o `metatype` do parâmetro
é um `createZodDto` (`isZodDto(metatype)`). Ou seja:

```ts
async create(@Body() body: CreateOrderDto)   // ✅ valida (classe createZodDto)
async create(@Body() body: unknown)          // ❌ não valida
```

Passar um schema no `@ApiDoc` **não** valida a entrada sozinho — ele só documenta. A validação da
entrada depende do **tipo do parâmetro** no controller.

## Boas práticas: schema Zod como fonte de verdade

A combinação recomendada separa **contrato** de **validação**:

1. Escreva o **schema Zod** — é a fonte de verdade do contrato. Vai no `@ApiDoc` (body/query/
   param/response).
2. Para entrada que precisa validar, gere a **classe** com `createZodDto(schema)` e use-a **no
   parâmetro do controller** (`@Body()/@Query()/@Param()`) — é o que ativa o pipe.

```ts
export const createUserBodySchema = z.object({
  name: z.string().min(1),
  email: z.email(),
});

export class CreateUserBodyDto extends createZodDto(createUserBodySchema) {}
```

```ts
@ApiDoc({
  summary: 'Cria um usuário',
  statusCode: 201,
  body: createUserBodySchema,            // contrato → documentação (nome vem da rota)
  response: { 201: userResponseSchema },
})
@Post('/')
async create(@Body() body: CreateUserBodyDto) {   // classe → validação pelo pipe
  return this.service.create(body);
}
```

Notas:

- **Respostas:** prefira **schema Zod puro** — respostas não passam pelo pipe e o nome já vem da
  rota, então não há ganho em envolvê-las num `createZodDto`.

## Campos do `ApiDocParams`

### `summary` e `description`

Texto da operação no Swagger/Scalar (`ApiOperation`).

### `body`

Schema do corpo da requisição. Documenta o body. Lembre: a **validação** vem do tipo do parâmetro
`@Body()`, não daqui.

### `query`

Schema da query string. Use `z.coerce` quando precisar converter string → número/boolean (query
chega sempre como string):

```ts
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

export class ListUsersQueryDto extends createZodDto(listUsersQuerySchema) {}
```

### `param`

Mapa de path params. Para um valor único, use o tipo primitivo — não gera model, só documenta o
tipo:

```ts
param: { id: 'string' }
```

Para validar o param em runtime, use uma classe DTO no `@Param()` e (opcionalmente) declare o
schema/DTO no `param` do `@ApiDoc` (aí vira o model `${rota}<chave>Param`):

```ts
@ApiDoc({ param: { id: 'string' }, /* ... */ })
@Get('/:id')
async findById(@Param() params: FindUserParamsDto) { /* ... */ }
```

### `security`

**Apenas documenta** a autenticação (`ApiBearerAuth`). **Não protege** a rota — a auth em runtime
é o `AuthGuard` global (fail-closed, provido pelo `AuthModule` — só existe com a auth ligada; hoje
está em standby), controlado por `@Public()`/`@AllowAnonymous()`/`@AllowUnverified()`.
Marcar `security` não tranca a rota; omitir não abre. A API só usa token Bearer (não há cookies),
então a única opção é:

```ts
security: { bearer: true }          // Authorization: Bearer <token>
```

### `response`

Mapa `status HTTP → schema`. Quando informado, o `@ApiDoc` injeta o `ZodResponseInterceptor`, que:

- olha o status real da resposta;
- procura o schema daquele status no mapa;
- valida o payload e devolve a versão parseada;
- lança erro se não bater (e ignora status que não estão no mapa).

```ts
response: {
  200: userResponseSchema,
  404: httpReplySchema,
}
```

Use `httpReplySchema` (`src/core/filters/http/http.schema.ts`) para erros padronizados.

### `statusCode`

Define o `HttpCode` da rota (default `200`). Em `204`, não declare body de resposta:

```ts
@ApiDoc({ summary: 'Remove um usuário', statusCode: 204 })
@Delete('/:id')
async remove(@Param('id') id: string) {
  await this.service.remove(id);
}
```

## Organização: um arquivo (ou diretório) só de documentação

Para manter o controller limpo, **tire o objeto do `@ApiDoc` de dentro do controller** e coloque-o
num arquivo de documentação por feature. Há dois níveis, conforme o tamanho da feature:

### Opção A — um arquivo `*.doc.ts` por feature

```txt
src/modules/users/
  users.controller.ts
  users.service.ts
  users.doc.ts          ← documentação (objetos ApiDocParams)
  users.schemas.ts      ← schemas Zod + classes DTO
```

### Opção B — um diretório `docs/` (feature com muitas rotas)

```txt
src/modules/users/
  users.controller.ts
  docs/
    users.doc.ts
  dtos/ (ou schemas/)
    user.schemas.ts
```

É o padrão usado no projeto — veja `src/modules/auth/email/docs/`, `src/modules/auth/session/docs/`
e `src/infra/health/docs/`.

`user.schemas.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createUserBodySchema = z.object({
  name: z.string().min(1),
  email: z.email(),
});

export class CreateUserBodyDto extends createZodDto(createUserBodySchema) {}

export const userResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
});
```

`docs/users.doc.ts`:

```ts
import type { ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
import { createUserBodySchema, userResponseSchema } from '../dtos/user.schemas';

export const createUserDoc: ApiDocParams = {
  summary: 'Cria um usuário',
  description: 'Cria um usuário e retorna os dados públicos cadastrados.',
  statusCode: 201,
  body: createUserBodySchema,
  response: { 201: userResponseSchema },
};
```

`users.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';
import { createUserDoc } from './docs/users.doc';
import { CreateUserBodyDto } from './dtos/user.schemas';

@Controller('/users')
export class UsersController {
  @ApiDoc(createUserDoc)
  @Post('/')
  async create(@Body() body: CreateUserBodyDto) {
    return this.service.create(body);
  }
}
```

## Checklist para uma rota nova

1. Escreva o schema Zod do contrato (body/query/param/response).
2. Para entrada que valida, crie a classe `createZodDto(schema)`.
3. Crie um `ApiDocParams` em `*.doc.ts` (ou `docs/*.doc.ts`).
4. Informe `summary`, `description` quando ajudar, `statusCode`, `body`/`query`/`param`,
   `security` e `response`.
5. Use `@ApiDoc(documento)` no controller.
6. Use as **classes DTO** nos parâmetros `@Body()/@Query()/@Param()` que precisam de validação.
7. Cadastre em `response` todos os status que devem ser documentados e validados.

## Exemplo completo

> Ilustrativo: o módulo `order/` ainda não existe (ver [specs.md](../../project/specs.md)).

`dtos/order.schemas.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOrderSchema = z.object({
  produtoId: z.string().min(1),
  quantidade: z.number().int().positive(),
});

export class CreateOrderDto extends createZodDto(createOrderSchema) {}

export const orderResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
});
```

`docs/order.doc.ts`:

```ts
import type { ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
import { httpReplySchema } from 'src/core/filters/http/http.schema';
import { createOrderSchema, orderResponseSchema } from '../dtos/order.schemas';

export const createOrderDoc: ApiDocParams = {
  summary: 'Cria um pedido',
  description: 'Cria um pedido para o usuário autenticado.',
  statusCode: 201,
  security: { bearer: true },
  body: createOrderSchema,
  response: {
    201: orderResponseSchema,
    400: httpReplySchema,
    401: httpReplySchema,
  },
};
```

`order.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';
import { createOrderDoc } from './docs/order.doc';
import { CreateOrderDto } from './dtos/order.schemas';

@Controller('/orders')
export class OrderController {
  @ApiDoc(createOrderDoc)
  @Post('/')
  async create(@Body() body: CreateOrderDto) {
    return this.service.create(body);
  }
}
```

Resultado:

- a rota aparece no Swagger/Scalar com `summary`/`description`;
- o body é documentado como `OrderCreateBody`;
- o body é validado pelo `ZodValidationPipe` (porque o parâmetro é `CreateOrderDto`);
- a rota fica marcada como autenticada por token Bearer (documentação);
- o status principal é `201`;
- a resposta `201` é documentada como `OrderCreate201` e validada pelo `ZodResponseInterceptor`;
- os erros `400` (`OrderCreate400`) e `401` (`OrderCreate401`) ficam documentados.
