# Integração ViaCEP (`src/integrations/viacep`)

Consulta de endereço por CEP na API pública [ViaCEP](https://viacep.com.br), sem chave, só com
`fetch` e Zod. A integração não conhece o domínio; quem consome é o módulo de conversa, pelo token
`VIACEP_CLIENT` (provido por `ViacepModule`).

## Uso

```ts
const address = await viacep.lookup('64000-000');
```

`lookup(cep)` devolve `ViacepAddress` (`postalCode`, `street`, `neighborhood`, `city`, `state`) ou
`null`. O CEP aceita máscara; `postalCode` volta só com dígitos.

## Modos

| `VIACEP_MODE` | Efeito |
|---|---|
| `live` | `GET {VIACEP_API_URL}/{cep}/json/` com `fetch` e `AbortSignal.timeout` |
| `fake` | `FakeViacepClient` em memória, sem rede |

Vazio: `fake` com `NODE_ENV=test`, `live` nos demais casos.

## Variáveis

| Variável | Default | Função |
|---|---|---|
| `VIACEP_MODE` | vazio = automático | `live` ou `fake` |
| `VIACEP_API_URL` | `https://viacep.com.br/ws` | URL base (a barra final é removida) |
| `VIACEP_TIMEOUT_MS` | `5000` | Timeout de cada consulta |

Detalhes em `docs/guides/conventions/environment.md`.

## Erros

- `null`: CEP com tamanho diferente de 8 dígitos (nem chama a rede), CEP inexistente
  (`{ "erro": true }`) e status 400/404 do ViaCEP.
- `ViacepError` (`src/core/erros/viacep/viacep.errors.ts`): timeout, falha de rede, status 5xx ou
  outro status inesperado, e resposta fora do formato. Não há retry.

## Fake

```ts
const viacep = new FakeViacepClient();
viacep.set('64000000', {
  postalCode: '64000000',
  street: 'Rua A',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
});
viacep.failNext();
```

`set` programa um CEP; CEP desconhecido devolve `null`; `failNext()` faz só a próxima chamada
lançar `ViacepError`. Os testes nunca chamam a rede real.
