# Integração com a LLM — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Camada `src/integrations/llm` completa (contrato, cliente live compatível com OpenAI apontando
para o Gemini, cliente fake, erros, config, módulo Nest, `pnpm llm:check`, docs), pronta para módulos
futuros só injetarem `LLM_CLIENT`.

**Architecture:** Mesmo molde de `src/integrations/whatsapp`: interface + `Symbol` token, factory que
escolhe `live`/`fake` pela config resolvida do `env`, cliente live com `fetch` puro e erros tipados em
`src/core/erros/llm/`. `generateObject` converte o schema Zod do chamador em JSON Schema
(`z.toJSONSchema`) para o `response_format` e valida a resposta localmente.

**Tech Stack:** NestJS 11, Zod 4 (`z.toJSONSchema`), `fetch` nativo, Vitest, Biome. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-10-20-llm-integration-design.md`

## Global Constraints

- Sem dependência nova (nada de `openai`, `@google/genai`); só `fetch` + Zod já instalado.
- Sem comentários explicativos `//` no código (CLAUDE.md).
- `LLM_API_KEY`, prompts, mensagens e respostas da LLM **nunca** em log, mensagem de erro ou resposta HTTP, em nenhum ambiente.
- Uma tentativa por chamada, sem retry; timeout padrão `8000` ms (`LLM_TIMEOUT_MS`).
- `generateObject` nunca devolve objeto que não passou em `schema.safeParse`.
- Padrões de env: `LLM_API_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `LLM_MODEL=gemini-3.8-flash` (confirmado na Task 6), `LLM_MODE` = `live` se houver `LLM_API_KEY`, senão `fake`.
- Textos de log/erro em português, mesmo estilo de `whatsapp.errors.ts`.
- Commits convencionais, **sem** trailer `Co-Authored-By` nem `Claude-Session`.
- Antes de cada commit: `pnpm lint` e `pnpm test` verdes.

## Review Focus

1. **Gemini devolve erro como array** (`[{ "error": { … } }]`) → a mensagem é extraída igual ao formato objeto. Teste na Task 1.
2. **Chave inválida chega como 400** com `API_KEY_INVALID` no corpo → vira `LlmUnauthorizedError`, não `LlmRejectedError`. Teste na Task 1.
3. **Modelo responde JSON dentro de cerca markdown** (```` ```json … ``` ````) mesmo com `response_format` → a cerca é removida antes do `JSON.parse`. Teste na Task 3.
4. **Mensagem de erro do provedor gigante ou ecoando o pedido** → truncada em 200 caracteres e nunca contém a chave. Teste na Task 1.
5. **`content` nulo com `finish_reason: "stop"`** (resposta bloqueada silenciosamente) → `LlmResponseError`, não crash. Teste na Task 4.

---

### Task 1: Erros da LLM

**Files:**
- Create: `src/core/erros/llm/llm.errors.ts`
- Test: `src/core/erros/llm/llm.errors.spec.ts`

**Interfaces:**
- Produces:
  - `type LlmErrorKind = 'unauthorized' | 'rate_limited' | 'rejected' | 'unavailable' | 'response' | 'invalid_output'`
  - `interface LlmIssue { path: string; message: string }`
  - `class LlmError extends Error { readonly kind: LlmErrorKind; readonly status?: number }` (`name = new.target.name`)
  - `LlmUnauthorizedError(message, status?)`, `LlmRateLimitedError(message, status?)`, `LlmRejectedError(message, status?)`, `LlmUnavailableError(message, status?)`, `LlmResponseError(message, status?)`
  - `LlmInvalidOutputError(issues: LlmIssue[])` com `readonly issues`, mensagem `'Saída da LLM fora do schema esperado'`
  - `llmErrorDetails(body: unknown): { message?: string; reason?: string }`
  - `mapLlmError(status: number, body: unknown): LlmError`

- [ ] **Step 1: Escrever os testes**

```ts
describe('mapLlmError', () => {
  it('401 e 403 → LlmUnauthorizedError');
  it('400 com API_KEY_INVALID no corpo → LlmUnauthorizedError', () => {
    const body = [{ error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT',
      details: [{ reason: 'API_KEY_INVALID' }] } }];
    expect(mapLlmError(400, body)).toBeInstanceOf(LlmUnauthorizedError);
  });
  it('429 → LlmRateLimitedError com status 429');
  it('500 e 503 → LlmUnavailableError');
  it('outros 4xx → LlmRejectedError');
  it('lê a mensagem no formato objeto { error: { message } }', () => {
    expect(mapLlmError(400, { error: { message: 'modelo inexistente' } }).message).toBe('modelo inexistente');
  });
  it('lê a mensagem no formato array [{ error: { message } }]');
  it('sem mensagem no corpo → "LLM respondeu {status}"');
  it('trunca mensagens com mais de 200 caracteres', () => {
    expect(mapLlmError(400, { error: { message: 'x'.repeat(500) } }).message.length).toBeLessThanOrEqual(200);
  });
});
describe('LlmInvalidOutputError', () => {
  it('guarda issues e tem kind invalid_output');
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/core/erros/llm` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** — molde de `src/core/erros/whatsapp/whatsapp.errors.ts`. `llmErrorDetails` aceita objeto ou array (usa o primeiro item), lê `error.message` e procura `reason` em `error.details[].reason` ou `error.status`. Unauthorized: `401 | 403`, ou `400` com `reason === 'API_KEY_INVALID'`. Usar `truncate` de `src/utils/text`.

- [ ] **Step 4: Rodar e ver passar** — `pnpm test src/core/erros/llm` → PASS.

- [ ] **Step 5: Commit** — `git add src/core/erros/llm && git commit -m "feat(llm): erros tipados da integração com a LLM"`

---

### Task 2: Configuração e variáveis de ambiente

**Files:**
- Modify: `src/config/env.ts` (bloco `// LLM` depois do WhatsApp)
- Create: `src/integrations/llm/shared/llm.config.ts`
- Test: `src/integrations/llm/shared/llm.config.spec.ts`
- Modify: `.env.example` (substituir `# LLM - definir quando…`)
- Modify: `vitest.config.e2e.ts` (`env.LLM_MODE: 'fake'`)
- Modify: `docs/guides/conventions/environment.md` (seção "## LLM", mesmo formato de tabela do WhatsApp)

**Interfaces:**
- Produces:
  - env: `LLM_MODE` (`'live' | 'fake'` opcional), `LLM_API_URL` (url, padrão acima), `LLM_API_KEY` (string opcional), `LLM_MODEL` (string min 1, padrão `gemini-3.8-flash`), `LLM_TIMEOUT_MS` (int positivo, padrão `8000`) — todos com `emptyAsUndefined`.
  - `type LlmMode = 'live' | 'fake'`
  - `interface LlmConfig { mode: LlmMode; baseUrl: string; apiKey?: string; model: string; timeoutMs: number }`
  - `resolveLlmConfig(env: Env): LlmConfig` — lança `Error('LLM_API_KEY obrigatório com LLM_MODE=live')`.

- [ ] **Step 1: Escrever os testes** (molde de `whatsapp.config.spec.ts`, mesmo `base`/`parse`)

```ts
it('usa fake sem chave, com os padrões', () => {
  expect(resolveLlmConfig(parse())).toEqual({
    mode: 'fake', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: undefined, model: 'gemini-3.8-flash', timeoutMs: 8000 });
});
it('usa live quando há LLM_API_KEY e LLM_MODE não foi definido');
it('respeita LLM_MODE=fake mesmo com chave');
it('falha com LLM_MODE=live sem chave', () => {
  expect(() => resolveLlmConfig(parse({ LLM_MODE: 'live' }))).toThrow('LLM_API_KEY');
});
it('trata string vazia como ausente', () => {
  expect(resolveLlmConfig(parse({ LLM_API_KEY: '', LLM_MODEL: '' })).model).toBe('gemini-3.8-flash');
});
it('remove barra final da URL base');
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/integrations/llm/shared` → FAIL.

- [ ] **Step 3: Implementar** env + `resolveLlmConfig` (molde de `resolveWhatsappConfig`); `baseUrl` sem `/` final. Atualizar `.env.example` (comentário: chave em aistudio.google.com, plano gratuito), `vitest.config.e2e.ts` e `environment.md` (tabela com as 5 variáveis + nota: `live` exige chave; `fake` em produção só loga aviso e o bot fica só com botões).

- [ ] **Step 4: Rodar e ver passar** — `pnpm test src/integrations/llm/shared` → PASS; `pnpm test` inteiro verde.

- [ ] **Step 5: Commit** — `git commit -m "feat(llm): configuração e variáveis de ambiente da LLM"`

---

### Task 3: Contrato, validação da saída e cliente fake

**Files:**
- Create: `src/integrations/llm/llm.client.ts`
- Create: `src/integrations/llm/llm.schemas.ts`
- Create: `src/integrations/llm/shared/llm-output.ts`
- Create: `src/integrations/llm/fake-llm.client.ts`
- Test: `src/integrations/llm/shared/llm-output.spec.ts`, `src/integrations/llm/fake-llm.client.spec.ts`

**Interfaces:**
- Consumes: erros da Task 1.
- Produces:
  - `llm.client.ts`: `LLM_CLIENT = Symbol('LLM_CLIENT')`; `interface LlmClient { generateText(request: LlmTextRequest): Promise<LlmTextResult>; generateObject<T>(request: LlmObjectRequest<T>): Promise<LlmObjectResult<T>> }`; `type LlmLogger = { info(obj: object, msg: string): void; warn(obj: object, msg: string): void }`.
  - `llm.schemas.ts`: `LlmMessage { role: 'system' | 'user' | 'assistant'; content: string }`, `LlmTextRequest { operation: string; messages: LlmMessage[]; temperature?: number; maxOutputTokens?: number; timeoutMs?: number }`, `LlmObjectRequest<T> extends LlmTextRequest { schema: z.ZodType<T>; schemaName: string }`, `LlmUsage { inputTokens?: number; outputTokens?: number }`, `LlmTextResult { text: string; model: string; usage: LlmUsage; durationMs: number }`, `LlmObjectResult<T> { object: T; model: string; usage: LlmUsage; durationMs: number }`, e `chatCompletionSchema` (Zod, tolerante a extras): `{ model?: string; choices: [{ message: { content?: string | null }; finish_reason?: string | null }] (min 1); usage?: { prompt_tokens?: number; completion_tokens?: number } | null }`.
  - `llm-output.ts`: `validateLlmObject<T>(value: unknown, schema: z.ZodType<T>): T` (lança `LlmInvalidOutputError` com issues `{ path: issue.path.join('.'), message: issue.message }`, sem valores); `parseLlmObject<T>(content: string, schema: z.ZodType<T>): T` (remove cerca ```` ```json ```` / ```` ``` ```` e espaços, `JSON.parse`; JSON inválido → `LlmInvalidOutputError([{ path: '', message: 'JSON inválido' }])`; depois `validateLlmObject`).
  - `fake-llm.client.ts`: `type FakeLlmReply = { text: string } | { object: unknown } | LlmError`; `type FakeLlmHandler = (request: LlmTextRequest | LlmObjectRequest<unknown>) => FakeLlmReply | Promise<FakeLlmReply>`; `interface FakeLlmCall { operation: string; messages: LlmMessage[]; schemaName?: string }`; `class FakeLlmClient implements LlmClient` com `readonly calls: FakeLlmCall[]`, `queueText(text)`, `queueObject(value)`, `queueError(error: LlmError)`, `respondWith(handler)`, `clear()`. Resultado: `model: 'fake'`, `usage: {}`, `durationMs: 0`.

- [ ] **Step 1: Escrever os testes**

```ts
describe('parseLlmObject', () => {
  const schema = z.object({ quantidade: z.number().int(), pagamento: z.enum(['pix', 'dinheiro']).optional() });
  it('aceita JSON válido', () => expect(parseLlmObject('{"quantidade":2}', schema)).toEqual({ quantidade: 2 }));
  it('remove cerca markdown ```json', () =>
    expect(parseLlmObject('```json\n{"quantidade":2}\n```', schema)).toEqual({ quantidade: 2 }));
  it('JSON inválido → LlmInvalidOutputError');
  it('fora do schema → issues com caminho, sem o valor recebido', () => {
    const error = catchError(() => parseLlmObject('{"quantidade":"duas","pagamento":"cartão-secreto"}', schema));
    expect(error).toBeInstanceOf(LlmInvalidOutputError);
    expect(error.issues.map(i => i.path)).toEqual(['quantidade', 'pagamento']);
    expect(JSON.stringify(error.issues)).not.toContain('cartão-secreto');
  });
});
describe('FakeLlmClient', () => {
  it('sem resposta programada → LlmUnavailableError');
  it('devolve respostas da fila em ordem e registra calls (operation, messages, schemaName)');
  it('queueError lança o erro programado');
  it('respondWith é usado quando a fila está vazia');
  it('generateObject valida o objeto programado com o schema de quem chama');
  it('generateObject aceita { text } com JSON e generateText aceita { object } (JSON.stringify)');
  it('clear esvazia fila, handler e calls');
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/integrations/llm` → FAIL.
- [ ] **Step 3: Implementar** os quatro arquivos conforme as interfaces. Ordem no fake: fila → handler → `LlmUnavailableError('LLM simulada sem resposta programada')`.
- [ ] **Step 4: Rodar e ver passar** — `pnpm test src/integrations/llm` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(llm): contrato LlmClient, validação da saída e cliente fake"`

---

### Task 4: Cliente live compatível com OpenAI

**Files:**
- Create: `src/integrations/llm/openai-compatible-llm.client.ts`
- Create: `src/integrations/llm/testing/llm.testing.ts`
- Test: `src/integrations/llm/openai-compatible-llm.client.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 e 3 (`chatCompletionSchema`, `parseLlmObject`, `LlmLogger`, erros).
- Produces:
  - `type OpenAiCompatibleOptions = { baseUrl: string; apiKey: string; model: string; timeoutMs: number; logger: LlmLogger; fetch?: typeof fetch; now?: () => number }`
  - `class OpenAiCompatibleLlmClient implements LlmClient`
  - `testing/llm.testing.ts`: `completion(content: string | null, overrides?: { finishReason?: string; model?: string; usage?: object })` → corpo de resposta; `providerError(status: number, message: string)` → `{ status, body }`.

Comportamento (da spec): `POST {baseUrl}/chat/completions`, headers `Authorization: Bearer {apiKey}` e `Content-Type: application/json`, corpo `{ model, messages, temperature?, max_tokens? }`; em `generateObject` também `response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } }` com `schema = z.toJSONSchema(request.schema)` sem a chave `$schema`. `AbortSignal.timeout(request.timeoutMs ?? timeoutMs)`. Uma tentativa. Mapeamento: falha de rede/timeout → `LlmUnavailableError`; `!ok` → `mapLlmError`; envelope inválido → `LlmResponseError`; `finish_reason === 'length'` → `LlmResponseError('Resposta da LLM cortada…')`; `finish_reason === 'content_filter'` → `LlmRejectedError`; `content` vazio/nulo → `LlmResponseError`. `model` do resultado = `body.model ?? options.model`; usage de `prompt_tokens`/`completion_tokens`. Logs: `info({ component: 'llm', operation, model, status, durationMs, inputTokens, outputTokens }, 'llm request')`; falhas `warn({ component: 'llm', operation, model, status?, durationMs, error }, 'llm request failed')`, com `error` = `'timeout' | 'network' | kind`.

- [ ] **Step 1: Escrever os testes** (molde do `setup()` de `cloud-api-whatsapp.client.spec.ts`)

```ts
it('generateText: POST /chat/completions com Bearer, modelo e mensagens', async () => {
  const { client, call } = setup([{ body: completion('Abrimos às 7h') }]);
  await expect(client.generateText(textRequest)).resolves.toMatchObject({ text: 'Abrimos às 7h', model: 'gemini-test' });
  expect(call().url).toBe('https://llm.test/chat/completions');
  expect(call().body).toMatchObject({ model: 'gemini-test', messages: textRequest.messages });
});
it('generateObject: envia response_format json_schema com strict e sem $schema', () => {
  expect(call().body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'pedido', strict: true } });
  expect(call().body.response_format.json_schema.schema).not.toHaveProperty('$schema');
  expect(call().body.response_format.json_schema.schema.properties).toHaveProperty('quantidade');
});
it('generateObject: devolve o objeto validado');
it('generateObject: objeto fora do schema → LlmInvalidOutputError');
it('repassa temperature, maxOutputTokens (max_tokens) e timeoutMs por chamada');
it('mapeia usage para inputTokens/outputTokens');
it.each([[401, LlmUnauthorizedError], [429, LlmRateLimitedError], [400, LlmRejectedError], [503, LlmUnavailableError]])('HTTP %i → erro tipado');
it('timeout → LlmUnavailableError, uma única chamada ao fetch', () => {
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('falha de rede → LlmUnavailableError');
it('envelope sem choices → LlmResponseError');
it('content nulo com finish_reason stop → LlmResponseError');
it('finish_reason length → LlmResponseError; content_filter → LlmRejectedError');
it('nenhum log contém a chave, as mensagens nem a resposta', () => {
  const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
  expect(logged).not.toContain(API_KEY);
  expect(logged).not.toContain('Rua das Flores 123');
  expect(logged).not.toContain('Abrimos às 7h');
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/integrations/llm/openai-compatible` → FAIL.
- [ ] **Step 3: Implementar** conforme o comportamento acima, no molde de `CloudApiWhatsappClient.post` (usar `parseJsonOrText` e `isTimeoutError` de `src/utils`).
- [ ] **Step 4: Rodar e ver passar** — PASS; `pnpm test` e `pnpm lint` verdes.
- [ ] **Step 5: Commit** — `git commit -m "feat(llm): cliente live compatível com OpenAI (Gemini)"`

---

### Task 5: Factory e `LlmModule`

**Files:**
- Create: `src/integrations/llm/llm.factory.ts`, `src/integrations/llm/llm.module.ts`
- Test: `src/integrations/llm/llm.factory.spec.ts`, `src/integrations/llm/llm.module.spec.ts`

**Interfaces:**
- Consumes: `LlmConfig`/`resolveLlmConfig` (Task 2), `FakeLlmClient` (Task 3), `OpenAiCompatibleLlmClient` (Task 4).
- Produces:
  - `type CreateLlmDeps = { logger?: LlmLogger; fetch?: typeof fetch; nodeEnv?: string }`
  - `createLlmClient(config: LlmConfig, deps?: CreateLlmDeps): LlmClient`
  - `@Module LlmModule` provendo e exportando `LLM_CLIENT` via `createLlmClient(resolveLlmConfig(env), { logger: createLogger('LlmClient'), nodeEnv: env.NODE_ENV })`.

- [ ] **Step 1: Escrever os testes**

```ts
it('mode fake → FakeLlmClient');
it('mode live → OpenAiCompatibleLlmClient');
it('fake em produção loga um aviso', () => {
  createLlmClient(config(), { logger: log, nodeEnv: 'production' });
  expect(log.warn).toHaveBeenCalledOnce();
});
it('LlmModule resolve LLM_CLIENT', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [LlmModule] }).compile();
  expect(typeof moduleRef.get(LLM_CLIENT).generateObject).toBe('function');
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.
- [ ] **Step 3: Implementar** no molde de `whatsapp.factory.ts` / `whatsapp.module.ts`. Aviso: `'Cliente LLM simulado em produção (LLM_MODE=fake): a IA fica desligada e o bot usa só botões'`.
- [ ] **Step 4: Rodar e ver passar** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(llm): factory e LlmModule"`

---

### Task 6: `pnpm llm:check` contra o Gemini real

**Files:**
- Create: `scripts/llm.live-check.spec.ts`
- Modify: `package.json` scripts

**Interfaces:**
- Consumes: `resolveLlmConfig`, `createLlmClient` (Tasks 2 e 5), erros (Task 1).

- [ ] **Step 1: Ajustar scripts**
  - `"revgas:check": "vitest run --config vitest.config.live.ts scripts/revgas.live-check.spec.ts"`
  - `"llm:check": "vitest run --config vitest.config.live.ts scripts/llm.live-check.spec.ts"`

- [ ] **Step 2: Escrever o script** — `describe.skipIf(!env.LLM_API_KEY)`, cliente via `createLlmClient(resolveLlmConfig({ ...env, LLM_MODE: 'live' }))`:

```ts
it('generateText responde texto não vazio', ...);
it('generateObject segue um schema parecido com interpretar()', async () => {
  const schema = z.object({
    intencao: z.enum(['pedido', 'duvida', 'atendente', 'outro']),
    quantidade: z.number().int().positive().optional(),
    pagamento: z.enum(['pix', 'dinheiro', 'cartao']).optional(),
    endereco: z.object({ logradouro: z.string(), numero: z.string().optional() }).optional(),
    confianca: z.number().min(0).max(1),
  });
  const { object } = await llm.generateObject({ operation: 'check', schemaName: 'interpretacao', schema,
    messages: [{ role: 'system', content: 'Extraia o pedido de gás.' },
               { role: 'user', content: 'manda 2 botijão no pix' }] });
  expect(object.intencao).toBe('pedido');
  expect(object.quantidade).toBe(2);
});
it('chave inválida → LlmUnauthorizedError', ...);
```

- [ ] **Step 3: Rodar contra a API real** — com `LLM_API_KEY` no `.env`: `pnpm llm:check` → 3 PASS. Sem chave → skip. **Precisa da chave do usuário**: se não houver, pedir para gerar em aistudio.google.com e colocar no `.env`.
- [ ] **Step 4: Ajustar com base no resultado real**, sem mudar o contrato: (a) se o modelo padrão não existir/no plano gratuito, trocar o padrão de `LLM_MODEL` (env.ts, config spec, `.env.example`, `environment.md`); (b) se o Gemini recusar o JSON Schema ou `strict`, adaptar dentro de `OpenAiCompatibleLlmClient` (com teste unitário); (c) se chave inválida não vier como 401/403 nem `API_KEY_INVALID`, ajustar `mapLlmError` (com teste); (d) se o teste de texto/objeto passar perto de 8 s ou der `length`, avaliar `reasoning_effort` como env opcional.
- [ ] **Step 5: Confirmar** — `pnpm llm:check`, `pnpm revgas:check` (só o arquivo dele), `pnpm test`, `pnpm lint` verdes.
- [ ] **Step 6: Commit** — `git commit -m "feat(llm): pnpm llm:check contra a API real"`

---

### Task 7: Documentação

**Files:**
- Create: `docs/guides/integrations/llm.md`
- Modify: `docs/security/SECURITY.md`, `CLAUDE.md`, `docs/README.md`, `docs/project/specs.md`

- [ ] **Step 1: Guia `llm.md`** no estilo de `docs/guides/integrations/whatsapp.md`, com as seções: Estrutura · Modos (`LLM_MODE`) · Obter a chave (Google AI Studio, plano gratuito, limites por minuto/dia → 429) · Como um módulo consome (exemplo de gateway num módulo `assistant/` com `generateObject` + schema Zod) · Erros (tabela da spec + regra: qualquer `LlmError` → volta para os botões; `LlmInvalidOutputError` → pergunta de novo) · Testar com `FakeLlmClient` · Trocar de provedor (Groq: `LLM_API_URL=https://api.groq.com/openai/v1`) · `pnpm llm:check` · Armadilhas (schemas que o provedor recusa, latência/raciocínio, nunca mandar CPF à IA). Usar o que a Task 6 descobriu.
- [ ] **Step 2: `SECURITY.md`** — no plano gratuito as mensagens vão ao Google e podem ser usadas para treino (decisão aceita em 2026-10-20); mandar à IA só o texto necessário, nunca CPF; `LLM_API_KEY` só no servidor.
- [ ] **Step 3: `CLAUDE.md`** — `integrations/` ganha `llm/ — cliente da LLM compatível com OpenAI (Gemini; live/fake)`; secrets incluem `LLM_API_KEY`; índice ganha `docs/guides/integrations/llm.md`. **`docs/README.md`**: link do guia. **`specs.md`**: linha "IA" passa a dizer Gemini Flash (plano gratuito) via endpoint compatível com OpenAI.
- [ ] **Step 4: Conferir** — `pnpm lint` verde; links relativos existem.
- [ ] **Step 5: Commit** — `git commit -m "docs(llm): guia da integração, segurança e índices"`
