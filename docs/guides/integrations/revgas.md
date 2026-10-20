# Integração RevGás (`src/integrations/revgas`)

Cliente da API pública do ERP RevGás. Isola o chatbot do ERP: o domínio fala com a interface
`RevgasClient` e não sabe se do outro lado há a API real ou um simulador. A integração não conhece o
domínio (só fala com o serviço externo e valida respostas com Zod) e nunca importa `src/modules/`.

Contexto do produto: `docs/project/specs.md` (seção da integração RevGás) e o design em
`docs/superpowers/specs/2026-10-19-revgas-integration-design.md`.

## Estrutura

Um diretório por módulo da API RevGás, mais `shared/` com o que é comum. Cada módulo tem
`<m>.schemas.ts` (Zod tolerante: `z.looseObject`, campos opcionais exceto `id`; `payment_type` e
`status` aceitam string desconhecida), `<m>.api.ts` (interface e tipos de query),
`<m>.http.ts` (rotas reais), `<m>.fake.ts` (simulador) e `<m>.fixtures.ts` quando o simulador tem dados.

```
src/integrations/revgas/
  shared/            revgas-http (transporte), mask, revgas.errors, revgas.config,
                     pagination, open-enum, validation, clone, fake-id
  establishments/    products/    deals/    payment-types/    customers/    sales/
  revgas.client.ts          interface RevgasClient (composição dos módulos) e token REVGAS_CLIENT
  http-revgas.client.ts     createHttpRevgasClient(http, establishmentId)
  fake-revgas.client.ts     FakeRevgasClient (compõe os fakes; ownsSale/ownsCustomer)
  hybrid-revgas.client.ts   HybridRevgasClient (roteamento por módulo/operação)
  revgas.factory.ts         createRevgasClient(config, deps)
  revgas.module.ts          RevgasModule, que provê REVGAS_CLIENT conforme o modo
```

## Contrato

As chamadas são agrupadas por módulo da API:

```ts
revgas.establishments.list()
revgas.products.list(query?)
revgas.deals.list(query?) / revgas.deals.listAll(query?)
revgas.paymentTypes.list()
revgas.customers.findByPhone(phone) / get(id) / create(input) / update(id, input)
revgas.sales.create(input) / get(id) / list(query?) / cancel(id, motiveCancelSaleId?)
```

## Modos (`REVGAS_MODE`)

| Modo | O que faz |
| --- | --- |
| `live` | Tudo vai para a API real. Exige `REVGAS_API_KEY` e `REVGAS_ESTABLISHMENT_ID`. |
| `hybrid` | Leituras liberadas vão para a API real; o resto é simulado (tabela abaixo). Exige chave e estabelecimento. |
| `fake` | Tudo simulado em memória, sem rede. Não exige nada. |

Padrão (variável vazia): `hybrid` se houver `REVGAS_API_KEY`, senão `fake`. Em produção, qualquer
modo diferente de `live` gera um aviso no log no boot. Variáveis: ver
[environment.md](../conventions/environment.md).

## Roteamento do modo `hybrid`

| Operação | Destino |
| --- | --- |
| `establishments.list`, `products.list`, `deals.list`, `deals.listAll` | real |
| `paymentTypes.list` | simulado (derivado das negociações reais) |
| `customers.findByPhone`, `customers.get`, `customers.create`, `customers.update` | simulado |
| `sales.create`, `sales.cancel` | simulado |
| `sales.get` | simulado se o id pertence ao simulador, senão real |
| `sales.list` | simulado se o `customer_id` pertence ao simulador, senão real |

Os ids do simulador ficam numa faixa própria, para não colidir com ids reais.

## Permissões atuais da chave

A chave em uso é somente leitura:

- `GET /establishments`, `/products`, `/deals`, `/sales` → 200
- `GET /customers` e `/payment-types` → 403 (`RevgasForbiddenError`)
- `POST /sales` → sem permissão

Existe um único estabelecimento (id 2580). Por isso o modo padrão com chave é `hybrid`.

## Quando a RevGás liberar uma operação

1. Confirmar com `pnpm revgas:check` (ou uma chamada manual) que a operação deixou de dar 403.
2. Se todas as operações usadas pelo fluxo estiverem liberadas, usar `REVGAS_MODE=live` (troca da API inteira, só configuração).
3. Se só algumas forem liberadas, passar um módulo ou operação para real exige mudança de código: editar o roteamento em
   `HybridRevgasClient` (mover o módulo/operação de `fake` para `live`; mudança pequena, com teste), ajustar a tabela acima e os testes em `hybrid-revgas.client.spec.ts`.
4. Antes de ligar `live` com vendas reais, testar `createSale` em um ambiente controlado.

## Erros

Todos estendem `RevgasError` (campos `kind` e `status`).

| Erro | `kind` | Quando aparece |
| --- | --- | --- |
| `RevgasUnauthorizedError` | `unauthorized` | 401: chave ausente ou inválida |
| `RevgasBlockedError` | `blocked` | 402: conta bloqueada |
| `RevgasForbiddenError` | `forbidden` | 403: chave sem permissão para a rota |
| `RevgasNotFoundError` | `not_found` | 404 |
| `RevgasValidationError` | `validation` | entrada inválida (antes de qualquer chamada, `fields` vem do Zod) ou 400/422 da API |
| `RevgasDuplicateError` | `duplicate` | 409 de objeto duplicado (`existingId` quando a API informa) |
| `RevgasUnavailableError` | `unavailable` | 429, 5xx, lock 409, timeout ou falha de rede em GET após esgotar as tentativas; em POST/PUT, 429 e lock 409 (sem retry) |
| `RevgasResponseError` | `response` | resposta fora do schema (`issues`) ou status inesperado |
| `RevgasUnknownOutcomeError` | `unknown_outcome` | POST/PUT com timeout, falha de rede ou resposta 5xx: não se sabe se o ERP executou |

## Transporte

- Header `Authorization: <chave>` (sem `Bearer`); base padrão `https://api.revgas.com/v1`.
- Fila serial com intervalo mínimo entre chamadas (`REVGAS_MIN_INTERVAL_MS`, 1 req/s) e timeout
  por chamada (`REVGAS_TIMEOUT_MS`).
- GET é repetido com backoff exponencial em 429, 5xx, lock e falhas de rede.
- `sales.list({ status: 'WARNING' })` vai para a API como `WARN` (o filtro usa `WARN`, as respostas trazem `WARNING`).
- `customers.findByPhone` devolve `[]` sem chamar a API se o telefone tiver menos de 10 ou mais de 13 dígitos.
- Logs nunca levam corpo de request/response; a query é mascarada (telefone, CPF, nome,
  logradouro). A chave nunca aparece em log, erro ou resposta.

## POST nunca é repetido

`POST` e `PUT` não têm retry automático: repetir poderia duplicar uma venda. Se a chamada expira
ou a rede cai, ou o servidor responde 5xx, a integração lança `RevgasUnknownOutcomeError` (a mensagem
não leva chave nem corpo). 429 e lock 409 em POST/PUT viram `RevgasUnavailableError`, também sem
retry. Quem chama deve:

1. Não reenviar a venda às cegas.
2. Conferir com `sales.list` (filtrando por `customer_id`, `from`/`to`) se a venda foi criada.
3. Só então reenviar (se não existir) ou seguir com a venda encontrada.

## Check manual contra a API real

```
pnpm revgas:check
```

Roda `scripts/revgas.live-check.spec.ts` com `vitest.config.live.ts`, usando o `.env` local.
Só faz GET, respeita o intervalo da config, usa logger silencioso e não imprime dados de cliente.
Verifica estabelecimentos, produtos, negociações (todas com `payment_type`) e vendas, e espera
`RevgasForbiddenError` em clientes e formas de pagamento (documenta a permissão atual; quando a
RevGás liberar, esses dois testes devem ser atualizados). Sem `REVGAS_API_KEY` a suíte é pulada.
Se `REVGAS_ESTABLISHMENT_ID` não estiver definido, usa 2580. Fica fora de `pnpm test` e
`pnpm test:e2e`.
