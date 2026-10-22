# Especificação técnica — RevGás AI Flow

> Extraído de [revgas-ai-flow.md](revgas-ai-flow.md). Define **como** o sistema será construído.

## Contexto

Chatbot de WhatsApp que atende clientes de uma revenda de gás (GLP) e cria a venda direto no ERP RevGás pela API pública, sem atendente humano no caminho feliz. Projeto de Extensão 2026.2 (ICEV) para a Flow.

## Stack

| Camada | Escolha | Observação |
| --- | --- | --- |
| Runtime | Node 24 | Gerenciador de pacotes: pnpm |
| HTTP | NestJS 11 + Fastify | Módulos, DI, guards/filters globais; validação com nestjs-zod |
| Estado da conversa | Redis com TTL | ioredis |
| Banco | PostgreSQL + Drizzle | Histórico, vendas criadas, métricas |
| Validação | Zod | Webhooks, respostas da API RevGás e saída da IA |
| Testes | Vitest | Unit + e2e; máquina de estados pura, testável sem WhatsApp e sem IA |
| Canal | WhatsApp Cloud API (oficial, da Meta) | Decidido; Evolution/Z-API descartados |
| IA | Gemini Flash (plano gratuito) via endpoint compatível com OpenAI | Só duas funções (ver abaixo); cliente em `integrations/llm` |
| CEP | ViaCEP | — |

## Estrutura de pastas

Três camadas:

- **`modules/`**: os domínios da aplicação. Cada domínio tem seus controllers, services e repositórios.
- **`infra/`**: conexão com cache e banco de dados.
- **`integrations/`**: clientes de serviços de terceiros que a aplicação consome (API RevGás, WhatsApp e LLM).

```
src/
  main.ts                   # bootstrap do NestJS (Fastify)
  app.module.ts             # registro dos módulos
  modules/
    conversation/           # máquina de estados do pedido (puro) + controller do webhook
      conversation.controller.ts
      conversation.service.ts       # recebe os eventos (dedup, envio) + função pura com transições e mensagens fixas
      conversation.repository.ts    # dedup de mensagens e estado da conversa (via infra/cache)
      messaging.gateway.ts          # envia as respostas (via integrations/whatsapp)
      contracts/                    # DTOs e tipos de entrada/saída do módulo
      conversation.states.ts
    customer/               # identificar e cadastrar cliente (RF02, RF03)
      customer.service.ts
      customer.repository.ts        # API RevGás (via integrations/revgas)
    catalog/                # produtos, preço, estoque e formas de pagamento (RF04, RF06)
    order/                  # resumo, total, idempotência e criação da venda (RF07, RF08, RF09)
      order.service.ts
      order.repository.ts           # API RevGás + vendas salvas no Postgres
    assistant/              # interpretar() e responderFaq() (RF10)
    metrics/                # painel da revenda (F08)
  infra/
    cache/                  # Redis (ioredis): estado da conversa com TTL
    database/               # Postgres + Drizzle: client, schema, migrations
  integrations/
    revgas/                 # cliente HTTP da API RevGás: API Key, retry com backoff, logs mascarados
    whatsapp/               # Cloud API da Meta: envio de texto, lista e botões + webhook
    llm/                    # cliente do modelo de IA
```

**Regras de dependência:**
- `modules/` depende de `infra/` e de `integrations/`, nunca o contrário.
- `integrations/` não conhece o domínio: só fala com o serviço externo e valida as respostas com Zod.
- Os services de um módulo não importam SDKs direto (Redis, Drizzle, `integrations/`). Esse acesso passa por **repositórios** (`*.repository.ts`: ler e gravar dados, seja no Redis, no Postgres ou em registros da API RevGás) ou por **gateways** (`*.gateway.ts`: ações de saída que não guardam nada, como enviar mensagem no WhatsApp).
- Cada cliente de `integrations/` tem um mock para os testes (API RevGás, provedor de mensagens e LLM).
- O `conversation.service` cuida dos eventos (dedup, envio, logs), mas a decisão do que responder fica numa função pura no mesmo arquivo: recebe o estado e a mensagem, devolve o novo estado e as respostas. Assim o fluxo inteiro pode ser testado com Vitest, sem WhatsApp e sem IA (RNF08).
- Os schemas Zod ficam no módulo que os usa (`*.schemas.ts`); nos módulos de domínio, DTOs e tipos de entrada/saída ficam em `contracts/`. As tabelas Drizzle ficam em `infra/database/schemas`.

> Os nomes dos domínios e dos arquivos são uma proposta para validar com o grupo.

## Contratos de IA

### `interpretar(mensagem, estadoAtual)`

Chamada só quando a mensagem não bate com botão nem palavra-chave. Saída validada com Zod:

```ts
{
  intencao: string        // ex.: "pedido", "faq", "atendente", "outro"
  produto?: string
  quantidade?: number
  pagamento?: string
  endereco?: { logradouro?: string; numero?: string; bairro?: string; referencia?: string }
  confianca: number       // 0..1; abaixo do limiar → reapresenta os botões
}
```

> Os tipos e valores de `intencao` são proposta; o documento só lista os campos.

### `responderFaq(pergunta)`

Responde a partir de um FAQ curto (poucas dezenas de perguntas) embutido no prompt. RAG com pgvector só se a base crescer.

**Regras:** saída inválida → perguntar de novo; IA indisponível → voltar aos botões; o prompt nunca recebe a API Key nem dados de outros clientes.

## Integração com a API RevGás

**Autenticação (confirmada):** API Key solicitada ao suporte da RevGás, guardada em variável de ambiente e usada só no backend. Ref.: [Autenticação e Permissão](https://revgas.stoplight.io/docs/revgas-api/en39g0vb0qwsb-autenticacao-e-permissao).

**Ambiente:** só produção. A homologação existe na doc, mas está marcada como "Não utilizar". Toda venda criada com a chave real é uma venda de verdade; desenvolvimento e testes usam o mock de `integrations/revgas`.

**Operações necessárias** (conferidas na spec em 2026-10-19; rotas e campos detalhados na spec privada, `docs/project/private/`, fora do git):

| # | Operação | Quando | Observação |
| --- | --- | --- | --- |
| 0 | Listar estabelecimentos | Setup (uma vez) | Dá o `establishment_id` da revenda, exigido em produtos, acordos, formas de pagamento e venda |
| 1 | Buscar cliente por telefone | Primeira mensagem | Busca aceita 10–11 dígitos com DDI 55 opcional |
| 2 | Cadastrar cliente | Cliente não encontrado | Telefone no cadastro vai **com** 55; a spec não marca campos obrigatórios |
| 3 | Atualizar cliente (opcional) | Endereço novo | O endereço da entrega vai no corpo da venda; atualizar o cadastro é opcional |
| 4 | Listar produtos | Escolha do produto | Traz estoque, **não traz preço** |
| 5 | Listar acordos | Cálculo do preço | **Fonte do preço**: valor sugerido e valor mínimo por produto, com escopo de cliente, categoria do cliente, forma de pagamento ou padrão da loja |
| 6 | Listar formas de pagamento | Escolha do pagamento | Enum fixo (dinheiro, Pix, cartões, vale-gás…); **não há campo de troco** → vai na observação |
| 7 | **Criar venda** | Após "confirmo" | Endereço, itens com valor unitário, pagamentos, canal `WHATSAPP`; retorna ID, total e status |
| 8 | Listar vendas | Repetir pedido / anti-duplicata | Filtro por cliente, canal e período (máx. 366 dias; sem datas = mês corrente) |
| 9 | Detalhar venda | "Meu gás chegou?" | Status e entregador; **não há webhook de status nem tempo estimado** |

### Preço

O preço vem dos **acordos** da RevGás, não do produto. Um acordo liga um produto a um valor sugerido e um valor mínimo e vale para um cliente, uma categoria de cliente, uma forma de pagamento ou como padrão da loja. O backend resolve o acordo aplicável e usa esse valor na venda; o cliente e a IA nunca definem preço (RN06).

Confirmado com dados reais (2026-10-19): **todo acordo é ligado a uma forma de pagamento**. Há três tipos: preço base por produto × forma de pagamento, preço por categoria de cliente e preço por cliente. O mesmo botijão pode custar diferente no Pix e no cartão, então o total definitivo só é mostrado depois do passo de pagamento. Prioridade suposta (a confirmar): cliente > categoria > base.

A lista de formas de pagamento aceitas pode ser derivada dos acordos. Os dados reais trazem valores fora do enum da spec (ex.: `GAS_DO_POVO`), então o schema é tolerante a valores novos.

O catálogo da RevGás mistura gás, água, vasilhames (casco vendido à parte), acessórios e itens de teste: o bot oferece só uma lista curada de produtos.

**Permissões da chave:** a chave atual é **só de leitura**: lê estabelecimentos, produtos, acordos e vendas, recebe 403 em clientes e formas de pagamento e não tem permissão para criar venda. Não há outra chave disponível. Até a RevGás liberar, identificação, cadastro e criação de venda (RF02, RF03, RF08) são desenvolvidos e demonstrados contra o mock de `integrations/revgas`, seguindo a spec; só as leituras são conferidas na API real.

### Restrições da API

- **Rate limit global de 1 req/s** (429): o cliente HTTP serializa as chamadas e guarda no Redis o que muda pouco (estabelecimento, produtos, acordos, formas de pagamento).
- **Sem idempotência:** antes de repetir uma criação de venda após timeout, consultar as vendas do cliente no canal WhatsApp.
- **Schemas sem campos obrigatórios declarados:** os schemas Zod de resposta são tolerantes (campos opcionais, extras ignorados); os obrigatórios reais só aparecem nos 422.
- **Erros específicos:** 402 (chave bloqueada por falta de pagamento), 409 por lock (pode repetir) ou por duplicidade (traz o ID existente, útil no cadastro de cliente).

## Confiabilidade

- **Idempotência:** a API RevGás não aceita chave de idempotência. A garantia é local: trava por conversa no Redis na confirmação, mais checagem de venda do mesmo cliente no canal WhatsApp antes de qualquer nova tentativa.
- **Retry:** backoff em 5xx, 429, 409 por lock e timeout. A criação de venda nunca é repetida às cegas: primeiro confere se a venda já existe.
- **Persistência:** ID da venda salvo no Postgres e enviado ao cliente; falha → alerta no log.
- **Logs:** toda chamada à API RevGás, com CPF e telefone mascarados.

## Dados

| Onde | O quê |
| --- | --- |
| Redis (TTL) | Estado da conversa e carrinho em andamento |
| Postgres | Histórico de conversas, vendas criadas, métricas do painel |

## Restrições do canal (WhatsApp)

- Lista interativa: até 10 opções.
- Botões de resposta: até 3 por mensagem.
- Mensagens iniciadas pelo bot fora da janela de 24h (lembrete de recompra, recuperação de carrinho) exigem template aprovado, o que afeta o roadmap.
- A camada de mensageria expõe uma interface única (enviar texto, lista e botões, marcar como lida). Provedor: Cloud API oficial da Meta. Detalhes em `docs/guides/integrations/whatsapp.md`.
