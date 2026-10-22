# Integração LLM (`src/integrations/llm`)

Camada de comunicação com o modelo de IA: **Gemini Flash no plano gratuito**, pelo endpoint
**compatível com OpenAI** (`POST {LLM_API_URL}/chat/completions`), só com `fetch` e Zod (sem SDK).
Ela oferece duas operações:

- **`generateText`**: texto livre.
- **`generateObject`**: pede JSON e só devolve um objeto que **passou no schema Zod de quem chamou**.

A integração não conhece o domínio e nunca importa `src/modules/`. Prompts e regras de negócio da
IA (`interpretar()`, FAQ, resumo de handoff) ficam no módulo que consome, não aqui.

> **Estado atual:** a camada está pronta, mas nenhum módulo a usa ainda; o fluxo do WhatsApp não
> chama a IA. A IA nunca decide preço, total nem cria venda, e o fluxo não depende dela: se ela
> falhar ou demorar, o bot volta para os botões.

## Estrutura

```
src/integrations/llm/
  shared/        llm.config (modo e variáveis), llm-output (tira cerca de código, JSON.parse, valida no schema)
  testing/       llm.testing.ts (respostas HTTP prontas; só para testes, fora do build)
  llm.client.ts                    interface LlmClient e token LLM_CLIENT
  llm.schemas.ts                   pedidos/resultados e o envelope da resposta (Zod)
  openai-compatible-llm.client.ts  cliente real (POST /chat/completions)
  fake-llm.client.ts               simulador em memória, programável
  llm.factory.ts                   createLlmClient
  llm.module.ts                    LlmModule (provê LLM_CLIENT)

src/core/erros/llm/llm.errors.ts   LlmError + subclasses + mapLlmError(status, body)
scripts/llm.live-check.spec.ts     pnpm llm:check
```

## Modos (`LLM_MODE`)

| Modo | O que faz |
| --- | --- |
| `live` | Chama a API real. Exige `LLM_API_KEY`. |
| `fake` | Não chama a rede. Responde o que o teste programou; **sem nada programado, lança `LlmUnavailableError`**. Não exige nada. |

Padrão (variável vazia): `live` se houver `LLM_API_KEY`, senão `fake`. Por isso o app sobe em
`fake` sem configurar nada, e nesse caso toda chamada falha com `LlmUnavailableError`: na prática
a IA fica desligada e o bot segue pelos botões. Em produção, `fake` só loga um aviso. Os testes
e2e forçam `fake` (`vitest.config.e2e.ts`). Variáveis:
[environment.md](../conventions/environment.md).

## Obter a chave (Google AI Studio)

1. Entre em [aistudio.google.com](https://aistudio.google.com) com uma conta Google.
2. Em **Get API key**, crie uma chave e copie para `LLM_API_KEY` no `.env`.
3. Rode `pnpm llm:check` (veja abaixo) antes de qualquer outra coisa.

O plano gratuito tem **limite por minuto e por dia**. Passou do limite, a API devolve **429** e a
camada lança `LlmRateLimitedError`. Não há controle de cota nem fallback para outro provedor: quem
chama volta para os botões.

## Como um módulo consome

O módulo importa `LlmModule` e injeta `LLM_CLIENT` **num gateway próprio** (por exemplo
`assistant/assistant.gateway.ts`), porque services não importam integrações direto (ver
`CLAUDE.md`) e é no gateway que moram os prompts. O módulo não precisa saber se está em `live` ou
`fake`, nem qual provedor está por trás. O exemplo abaixo é ilustrativo (o módulo `assistant/`
ainda não existe):

```ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmError, LlmInvalidOutputError } from '../../core/erros/llm/llm.errors';
import { LLM_CLIENT, type LlmClient } from '../../integrations/llm/llm.client';

const interpretacaoSchema = z.object({
  intencao: z.enum(['pedido', 'duvida', 'atendente', 'outro']),
  quantidade: z.number().int().positive().optional(),
  confianca: z.number().min(0).max(1),
});

export type Interpretacao = z.infer<typeof interpretacaoSchema>;

export type ResultadoInterpretacao =
  | { status: 'ok'; interpretacao: Interpretacao }
  | { status: 'reperguntar' }
  | { status: 'botoes' };

@Injectable()
export class AssistantGateway {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  async interpretar(texto: string): Promise<ResultadoInterpretacao> {
    try {
      const { object } = await this.llm.generateObject({
        operation: 'interpretar',
        schemaName: 'interpretacao',
        schema: interpretacaoSchema,
        messages: [
          { role: 'system', content: 'Extraia o pedido de gás da mensagem do cliente.' },
          { role: 'user', content: texto },
        ],
      });
      return { status: 'ok', interpretacao: object };
    } catch (error) {
      if (error instanceof LlmInvalidOutputError) {
        return { status: 'reperguntar' };
      }
      if (error instanceof LlmError) {
        return { status: 'botoes' };
      }
      throw error;
    }
  }
}
```

Parâmetros opcionais do pedido: `temperature`, `maxOutputTokens` e `timeoutMs` (substitui o
`LLM_TIMEOUT_MS` só naquela chamada). `operation` é um nome curto que vai para o log. O resultado
traz também `model`, `usage` (tokens) e `durationMs`.

`generateObject` garante o formato do schema, mas o conteúdo ainda é uma interpretação da IA:
preço e total continuam vindo do ERP, nunca dela.

## Erros

Todos estendem `LlmError` (`kind` e `status?`), em `src/core/erros/llm/llm.errors.ts`.

| Classe | `kind` | Quando |
| --- | --- | --- |
| `LlmUnauthorizedError` | `unauthorized` | 401/403, ou 400 com motivo `API_KEY_INVALID` ou mensagem do provedor sobre "API key" (o Gemini devolve 400 `INVALID_ARGUMENT` para chave inválida) |
| `LlmRateLimitedError` | `rate_limited` | 429 (limite por minuto ou cota diária do plano gratuito) |
| `LlmRejectedError` | `rejected` | outros 4xx, conteúdo bloqueado pelo provedor (`content_filter`) |
| `LlmUnavailableError` | `unavailable` | 5xx, timeout, falha de rede, ou `fake` sem resposta programada |
| `LlmResponseError` | `response` | envelope fora do formato, conteúdo vazio, resposta cortada (`finish_reason: length`) |
| `LlmInvalidOutputError` | `invalid_output` | `generateObject`: JSON inválido ou fora do schema; `issues` traz caminho e mensagem do Zod, **sem os valores** |

Regra para quem chama:

- **Qualquer `LlmError`**: o fluxo não pode travar, volta para os botões.
- **`LlmInvalidOutputError`**: a IA respondeu, mas fora do schema. Não se chuta; **pergunta de novo** ao cliente.

A mensagem do erro tem só status e reason (`LLM respondeu 429 (RESOURCE_EXHAUSTED)`); o texto livre
do provedor nunca é guardado, porque provedores podem ecoar o conteúdo enviado. A camada lê o reason
tanto no formato OpenAI (`{ error: ... }`) quanto no array que o Gemini às vezes devolve (`[{ error: ... }]`).
Schema que o Zod não converte para JSON Schema (`.transform()`, `z.date()`) vira `LlmRejectedError` sem chamar a API.
Os filtros HTTP globais não conhecem esses erros: o gateway é quem os captura.

## Testar com `FakeLlmClient`

`FakeLlmClient` guarda as chamadas em `calls` e responde pelo que foi programado:

```ts
const llm = new FakeLlmClient();
llm.queueObject({ intencao: 'pedido', quantidade: 2, confianca: 0.9 });
llm.queueError(new LlmRateLimitedError('limite'));
llm.respondWith(() => ({ text: '{"intencao":"outro","confianca":0.1}' }));
llm.clear();
```

- `queueText`, `queueObject` e `queueError` formam uma fila (uma resposta por chamada); sem fila vale o `respondWith`; sem nenhum dos dois, `LlmUnavailableError`.
- Em `generateObject`, o fake **valida com o schema de quem chamou**, como o cliente real: objeto fora do schema vira `LlmInvalidOutputError`. Texto programado passa pelo mesmo parse do cliente real.
- Em `generateText`, um `queueObject` volta serializado como JSON.
- `calls` registra `operation`, `messages` e `schemaName`, para o teste conferir o que foi enviado.

`src/integrations/llm/testing/llm.testing.ts` tem `completion()` e `providerError()` para montar
respostas HTTP nos testes do cliente real, com um `fetch` injetado.

## Trocar de provedor

Qualquer provedor compatível com OpenAI que aceite `response_format` com JSON Schema funciona só
mudando o `.env`, sem tocar no código. Exemplo, Groq:

```env
LLM_API_URL=https://api.groq.com/openai/v1
LLM_API_KEY=<chave do Groq>
LLM_MODEL=<modelo do Groq>
```

Depois rode `pnpm llm:check`. O nome do modelo e o suporte a `strict` variam por provedor.

## Conferir contra a API real (`pnpm llm:check`)

```bash
pnpm llm:check
```

Roda só `scripts/llm.live-check.spec.ts` com `vitest.config.live.ts`, usando o `.env` local
(`pnpm revgas:check` roda só o arquivo dele; os dois são independentes). **Sem `LLM_API_KEY` o
teste é pulado.** Ele confere:

1. `generateText` devolve texto não vazio.
2. `generateObject` segue um schema parecido com o do `interpretar()` (enum, número, objeto aninhado, campos opcionais) e extrai `intencao` e `quantidade` de "manda 2 botijão no pix".
3. Chave inválida vira `LlmUnauthorizedError`.

> **Confirmado contra a API real em 2026-10-22 (plano gratuito):**
>
> - **Modelo padrão `gemini-3.5-flash`**: respostas entre 1,4 e 2,2 s, e o JSON Schema com
>   `strict: true` é aceito. `pnpm llm:check` passou 3 vezes seguidas.
> - **`gemini-3.8-flash`** responde 503 (sobrecarregado) quase sempre no plano gratuito. **Não use.**
> - **Modelos "lite"** (`gemini-3.5-flash-lite`, `gemini-flash-lite-latest`) funcionam, mas a
>   latência varia de 2,5 a mais de 20 s e estoura o timeout de 8 s com frequência.
> - **Chave inválida** volta como 400 `INVALID_ARGUMENT`, sem `API_KEY_INVALID` nos `details`, com a
>   mensagem "Please pass a valid API key". O mapeamento reconhece "api key" na mensagem do
>   provedor só para classificar como `LlmUnauthorizedError`; o texto do provedor continua fora da
>   mensagem do erro.
> - Rodar o check várias vezes em sequência pode dar **429** (limite por minuto do plano gratuito).
>   Espere cerca de 30 s entre as rodadas.

## Comportamentos que valem saber

- **Uma tentativa por chamada, sem retry.** O cliente espera no WhatsApp; a saída para falha é o botão.
- **Timeout** de 8000 ms (`LLM_TIMEOUT_MS`), ou `timeoutMs` no pedido. Estourou: `LlmUnavailableError`.
- O cliente real tira uma **cerca de código markdown** (` ```json ... ``` `) da resposta antes do `JSON.parse`, porque alguns modelos embrulham o JSON.
- `generateObject` envia o schema como `response_format` (`json_schema`, `strict: true`, gerado por `z.toJSONSchema`), mas isso é só uma ajuda: **a validação local é a garantia**.
- **Logs** (`component: 'llm'`) levam `operation`, `model`, `status`, `durationMs`, tokens e o tipo do erro. **Nunca** prompt, resposta, mensagem do provedor nem a chave, em nenhum ambiente.

## Armadilhas

- **Schemas que o provedor recusa.** Alguns provedores rejeitam partes do JSON Schema (por exemplo `strict` com campos opcionais, ou certos formatos). A recusa vira `LlmRejectedError` (4xx). Teste o schema real com `pnpm llm:check` antes de depender dele e prefira schemas simples.
- **Latência e raciocínio.** Modelos com raciocínio podem passar de 8 s e estourar o timeout; nesse caso o bot cai nos botões. Ajuste `LLM_MODEL`, `maxOutputTokens` ou `LLM_TIMEOUT_MS` com base no `durationMs` do log.
- **Resposta cortada** (`finish_reason: length`) vira `LlmResponseError`; aumente `maxOutputTokens`.
- **Privacidade.** No plano gratuito o provedor pode usar as mensagens para treinar modelos. Mande à IA só o texto necessário e **nunca CPF**, nem dados de outros clientes ([SECURITY.md](../../security/SECURITY.md)).
- **Chave.** `LLM_API_KEY` só no servidor: nunca em log, erro, resposta HTTP ou prompt.
