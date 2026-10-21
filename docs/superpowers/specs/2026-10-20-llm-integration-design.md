# Design — Integração com a LLM (`src/integrations/llm`)

Data: 2026-10-20 · Status: rascunho para aprovação

## Intenção

Construir a camada que liga o sistema ao modelo de IA. Ela fica pronta e completa nesta etapa, para que
qualquer módulo futuro que use IA (`assistant/` com `interpretar()` e `responderFaq()`, o resumo do handoff)
só importe o `LlmModule` e injete o cliente. Esses módulos não devem precisar mexer nesta camada nem criar
peças de infraestrutura novas para falar com a LLM.

Pela especificação (`docs/project/funcionalidades.md`, `requisitos.md`), a IA entra só onde há texto livre.
Ela nunca decide preço, total, validação nem cria venda (G05, RN06), e o fluxo nunca depende dela: se a IA
falhar ou demorar, o bot volta para os botões (RNF06). Por isso a camada precisa **falhar rápido e com erro
tipado**, e a saída estruturada precisa ser **validada localmente**, nunca aceita de olho fechado.

## Decisões do usuário

- **Critério de escolha: o mais barato → plano gratuito.** O usuário aceitou que, no plano gratuito, o
  provedor pode usar as mensagens para treinar modelos.
- **Provedor: Google Gemini, modelo da família Flash.**
- **Só um provedor.** Quando a cota gratuita acabar ou o Gemini falhar, a camada devolve erro e quem chama
  volta para os botões. Não há fallback para um segundo provedor.
- **Escopo:** a parte de comunicação deve ficar pronta. Prompts e regras de negócio da IA ficam para os
  módulos que vão usá-la.

## Objetivos

- Contrato `LlmClient` estável, com duas operações: gerar texto livre e gerar objeto validado por um schema
  Zod passado por quem chama.
- Modo `live` (Gemini real) e modo `fake` (sem rede, programável nos testes), escolhidos por env, no mesmo
  molde de `integrations/whatsapp`.
- Erros traduzidos para tipos próprios em `core/erros/llm/`, para o domínio decidir (fallback ou handoff)
  sem conhecer HTTP.
- Trocar de provedor compatível com OpenAI (Groq, OpenRouter…) só mudando env, sem alterar código.
- Um comando para conferir a chave e o modelo contra a API real (`pnpm llm:check`).
- Documentação: guia da integração e variáveis de ambiente.

## Não objetivos

- Prompts de `interpretar()`, `responderFaq()` ou do resumo de handoff, o conteúdo do FAQ e o módulo `assistant/`.
- Ligar a IA ao fluxo do WhatsApp (`ConversationService`).
- Streaming, tool calling, embeddings, RAG, imagens.
- Fallback entre provedores, cache de respostas e controle de cota próprio.
- Chamar a API real no CI.

## Anti-objetivos (falha mesmo se "funcionar")

- `LLM_API_KEY` aparecer em log, erro, resposta HTTP ou mensagem de exceção (RNF02).
- Conteúdo da conversa (prompt ou resposta, que podem ter nome, endereço, CPF) aparecer em log (LGPD).
- `generateObject` devolver um objeto que não passou no schema Zod de quem chamou (guardrail "JSON
  validado; inválido = pergunta de novo, não chuta").
- Uma chamada à IA travar a conversa além do timeout, ou ser repetida automaticamente e somar latência
  (o cliente está esperando no WhatsApp; a saída para falha é o botão, não o retry).
- O módulo consumidor precisar saber se está em `live` ou `fake`, ou qual provedor está por trás.
- Instalar SDK de provedor (`openai`, `@google/genai`): o projeto usa `fetch` puro nas integrações.

## Fatos do provedor que restringem o design

Conferidos na documentação oficial em 2026-10-20:

- O Gemini expõe endpoint compatível com OpenAI em
  `https://generativelanguage.googleapis.com/v1beta/openai/` (`POST chat/completions`, header
  `Authorization: Bearer <chave>`).
- Esse endpoint aceita saída estruturada via `response_format` com JSON Schema (o exemplo oficial em JS
  usa `zodResponseFormat`, que envia `{ type: "json_schema", json_schema: { name, schema, strict } }`).
- O Groq (`https://api.groq.com/openai/v1`) aceita o mesmo formato, com `strict: true` em alguns modelos.
  É a alternativa por troca de env.
- O plano gratuito tem limite por minuto e por dia; o excesso volta como HTTP 429.
- O Zod 4 (já instalado, `^4.6.7`) gera JSON Schema com `z.toJSONSchema`, então não precisa de dependência nova.

## Arquitetura

```
src/integrations/llm/
  llm.client.ts                 LLM_CLIENT (Symbol) + interface LlmClient
  llm.module.ts                 LlmModule: provê e exporta LLM_CLIENT
  llm.factory.ts                createLlmClient(config, deps) → live ou fake
  openai-compatible-llm.client.ts   cliente live (fetch, formato OpenAI)
  fake-llm.client.ts            cliente fake programável
  llm.schemas.ts                tipos de request/result + schema Zod da resposta do provedor
  shared/llm.config.ts          resolveLlmConfig(env)
  testing/llm.testing.ts        helpers de teste (respostas HTTP prontas)
src/core/erros/llm/
  llm.errors.ts                 LlmError + subclasses + mapLlmError(status, body)
scripts/
  llm.live-check.spec.ts        pnpm llm:check
```

Cada arquivo de código tem `*.spec.ts` ao lado, como nas outras integrações.

Regras de dependência (as de sempre): `integrations/llm` não conhece domínio. Um módulo futuro importa
`LlmModule` e injeta `LLM_CLIENT` **num gateway próprio** (ex.: `assistant/assistant.gateway.ts`), seguindo
a regra do CLAUDE.md de que services não importam integrações direto. Esse gateway é do módulo consumidor,
porque é ali que moram os prompts. Ele é o único código que o consumidor escreve.

### Contrato

```ts
export const LLM_CLIENT = Symbol('LLM_CLIENT');

export interface LlmClient {
  generateText(request: LlmTextRequest): Promise<LlmTextResult>;
  generateObject<T>(request: LlmObjectRequest<T>): Promise<LlmObjectResult<T>>;
}

type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type LlmTextRequest = {
  operation: string;        // nome curto para logs, ex.: 'interpretar', 'faq'
  messages: LlmMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;       // sobrescreve LLM_TIMEOUT_MS para esta chamada
};

type LlmObjectRequest<T> = LlmTextRequest & {
  schema: z.ZodType<T>;
  schemaName: string;       // vai em json_schema.name
};

type LlmUsage = { inputTokens?: number; outputTokens?: number };

type LlmTextResult = { text: string; model: string; usage: LlmUsage; durationMs: number };
type LlmObjectResult<T> = { object: T; model: string; usage: LlmUsage; durationMs: number };
```

Os nomes exatos dos campos ficam a critério de quem implementar, desde que mantenham este conteúdo. O
importante é que `generateObject` receba o schema Zod e devolva `T` já validado.

### Cliente live (`OpenAiCompatibleLlmClient`)

- `POST {LLM_API_URL}/chat/completions` com `model`, `messages`, `temperature`, `max_tokens` (quando houver)
  e, em `generateObject`, `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }`,
  com `schema = z.toJSONSchema(request.schema)`.
- Timeout via `AbortSignal.timeout(timeoutMs)`. **Uma tentativa só, sem retry** (ver anti-objetivos).
- Resposta: valida o envelope com Zod (`choices[0].message.content`, `choices[0].finish_reason`, `model`,
  `usage`). O schema do envelope é tolerante a campos extras.
- `generateText`: devolve `content`. Vazio ou ausente → `LlmResponseError`.
- `generateObject`: `JSON.parse(content)` e depois `request.schema.safeParse`. JSON inválido ou fora do schema
  → `LlmInvalidOutputError` com `issues` (caminho + mensagem do Zod, **sem os valores**). A validação local
  é a garantia; a imposição de schema pelo provedor é só uma ajuda.
- `finish_reason === 'length'` → `LlmResponseError` (resposta cortada). Bloqueio de conteúdo
  (`content_filter` ou equivalente do Gemini) → `LlmRejectedError`.
- Logs (pino, `component: 'llm'`): `operation`, `model`, `status`, `durationMs`, tokens e tipo de erro.
  **Nunca** mensagens, prompt, resposta nem a chave, em nenhum ambiente.

### Erros (`core/erros/llm/llm.errors.ts`)

Mesmo molde de `whatsapp.errors.ts`: classe base `LlmError` com `kind` e `status?`, mais as subclasses:

| Classe | `kind` | Quando |
| --- | --- | --- |
| `LlmUnauthorizedError` | `unauthorized` | 401/403 (chave inválida ou sem permissão) |
| `LlmRateLimitedError` | `rate_limited` | 429 (limite por minuto ou cota diária do plano gratuito) |
| `LlmRejectedError` | `rejected` | outros 4xx, conteúdo bloqueado pelo provedor |
| `LlmUnavailableError` | `unavailable` | 5xx, timeout, falha de rede |
| `LlmResponseError` | `response` | envelope fora do formato, conteúdo vazio, resposta cortada |
| `LlmInvalidOutputError` | `invalid_output` | `generateObject`: JSON inválido ou fora do schema (`issues`) |

`mapLlmError(status, body)` lê a mensagem do erro no formato OpenAI (`{ error: { message, code } }`) e
também no formato em array que o Gemini às vezes devolve (`[{ error: … }]`). Mensagens de erro não podem
conter a chave nem o conteúdo enviado.

O Gemini pode devolver chave inválida como **400** (com `API_KEY_INVALID` ou similar no corpo), não 401.
Confirme com `pnpm llm:check` usando uma chave errada e, se for o caso, classifique pelo corpo também, para
virar `LlmUnauthorizedError`. *(Decisão minha.)*

Para o consumidor, a regra prática (que vai no guia) é: qualquer `LlmError` vira "volta para os botões",
e `LlmInvalidOutputError` vira "pergunta de novo". O domínio decide quando isso vira handoff.

### Cliente fake (`FakeLlmClient`)

- Não faz rede. Guarda as chamadas em `calls` (operação, mensagens, `schemaName`) para os testes conferirem.
- Programável: `respondWith(handler)`, em que o handler recebe a requisição e devolve texto, objeto ou lança
  um `LlmError`. Também há atalhos para enfileirar respostas (`queueText`, `queueObject`, `queueError`) e
  `clear()`.
- `generateObject` no fake **também valida** com o schema de quem chama, para o teste pegar objeto mal
  programado.
- Sem nada programado: lança `LlmUnavailableError`. Assim, rodar o app em `fake` sem chave exercita o
  caminho "IA fora → botões", que é o comportamento obrigatório (RNF06). *(Decisão minha.)*

### Configuração (`shared/llm.config.ts` + `src/config/env.ts`)

| Variável | Obrigatória | Padrão | Uso |
| --- | --- | --- | --- |
| `LLM_MODE` | Não | `live` se houver `LLM_API_KEY`, senão `fake` | `live` \| `fake` |
| `LLM_API_URL` | Não | `https://generativelanguage.googleapis.com/v1beta/openai` | base compatível com OpenAI |
| `LLM_API_KEY` | Em `live` | — | chave do Google AI Studio |
| `LLM_MODEL` | Não | um modelo Gemini Flash do plano gratuito* | id do modelo |
| `LLM_TIMEOUT_MS` | Não | `8000` | timeout de cada chamada |

\* Quem implementar escolhe o id padrão na lista atual de modelos gratuitos do Gemini (família Flash ou
Flash-Lite, priorizando latência baixa) e confirma com `pnpm llm:check`.

- `resolveLlmConfig` falha no boot se `LLM_MODE=live` sem `LLM_API_KEY`.
- `fake` em produção é permitido, mas loga um aviso no boot (igual ao WhatsApp): o bot funciona só com botões.
- `vitest.config.e2e.ts` força `LLM_MODE: 'fake'`.

### Verificação real (`pnpm llm:check`)

Script `scripts/llm.live-check.spec.ts`, rodado pelo `vitest.config.live.ts` que já existe (o include
`scripts/**/*.live-check.spec.ts` já pega o arquivo; o nome do arquivo segue esse padrão). Com a chave do
`.env`, ele faz uma chamada `generateText` curta e uma `generateObject` com um schema parecido com o de
`interpretar()` (enum, campo opcional, número, objeto aninhado). Assim confirma chave, modelo e que o Gemini
aceita o JSON Schema gerado pelo Zod. Não roda no CI.

*(Decisão minha.)* O include do `vitest.config.live.ts` pega todos os `*.live-check.spec.ts`. Por isso, cada
script do `package.json` passa o próprio arquivo:
`"llm:check": "vitest run --config vitest.config.live.ts scripts/llm.live-check.spec.ts"`. O `revgas:check`
recebe o mesmo ajuste, para não rodar a checagem da LLM.

## Testes

Unitários (Vitest), com `fetch` injetado:

- config: modo padrão, `live` sem chave falha, aviso de `fake` em produção;
- factory: devolve live ou fake;
- cliente live: corpo da requisição (modelo, mensagens, `response_format` com o JSON Schema), header de
  autorização, sucesso em texto e em objeto, 401/403/429/4xx/5xx, timeout, falha de rede, envelope inválido,
  conteúdo vazio, `finish_reason: length`, JSON inválido, objeto fora do schema; nenhum log com conteúdo
  nem com a chave;
- erros: `mapLlmError` nos dois formatos de corpo;
- fake: fila, handler, validação pelo schema, erro padrão quando nada foi programado.

E2e: o app sobe com `LlmModule` em `fake` (basta o boot existente, se algum módulo importar o `LlmModule`;
como nada importa ainda, um teste unitário do módulo Nest resolvendo `LLM_CLIENT` basta).

## Documentação a atualizar

- **Novo** `docs/guides/integrations/llm.md`: estrutura, modos, como obter a chave no Google AI Studio, como
  um módulo consome (exemplo de gateway com `generateObject` + schema), tabela de erros e o que fazer com
  cada um, limites do plano gratuito, troca de provedor por env, `pnpm llm:check`, armadilhas (schemas que o
  provedor não aceita, latência).
- `docs/guides/conventions/environment.md`: preencher a seção "LLM".
- `.env.example`: substituir o placeholder de LLM.
- `docs/security/SECURITY.md`: mensagens de clientes vão ao Google no plano gratuito e podem ser usadas para
  treino (aceito pelo usuário); orientar consumidores a mandar à IA só o texto necessário e nunca CPF.
- `CLAUDE.md`: `integrations/llm` na arquitetura, `LLM_API_KEY` na lista de segredos, guia no índice.
- `docs/README.md` e `docs/project/specs.md`: provedor escolhido.

## Deixado para quem implementar

- Nomes exatos de tipos e campos, desde que o contrato acima seja respeitado.
- O id padrão de `LLM_MODEL` (ver nota da tabela).
- Se manda `strict: true` sempre ou só quando o provedor aceita. Teste com `pnpm llm:check`; a validação
  local continua obrigatória de qualquer jeito.
- Se o Gemini precisar de algum ajuste no JSON Schema gerado (ex.: remover `$schema`), fazer a adaptação
  dentro do cliente live, sem vazar para o contrato.
- Se vale controlar o "raciocínio" do modelo (parâmetro `reasoning_effort` do endpoint compatível) para
  reduzir latência. Se usar, entra como env opcional. Atenção: nos modelos Flash, o raciocínio pode
  consumir o `max_tokens` e causar `finish_reason: length`; confira com `pnpm llm:check`.
- Se `strict` ou os ajustes de schema precisarem variar entre provedores, isso entra como env opcional
  (ex.: `LLM_STRICT_SCHEMA`), mantendo a troca de provedor só por env.
