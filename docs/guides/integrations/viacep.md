# Integração ViaCEP (`src/integrations/viacep`)

Consulta de endereço por CEP na API pública [ViaCEP](https://viacep.com.br), sem chave, só com
`fetch` e Zod. A integração não conhece o domínio; quem consome é o módulo de conversa, pelo token
`VIACEP_CLIENT`.

## Uso

```ts
const address = await viacep.lookup('
