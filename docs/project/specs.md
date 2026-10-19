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
| Canal | WhatsApp Cloud API (oficial) | Evolution API / Z-API para protótipo |
| IA | Modelo pequeno e barato | Só duas funções (ver abaixo) |
| CEP | ViaCEP | — |

## Estrutura de pastas

Três camadas:

- **`modules/`**: os domínios da aplicação. Cada domínio tem seus controllers, services e repositórios.
- **`infra/`**: conexão com cache e banco de dados.
- **`lib/`**: clientes de serviços de terceiros que a aplicação consome (API RevGás, WhatsApp e LLM).

```
src/
  main.ts                   # bootstrap do NestJS (Fastify)
  app.module.ts             # registro dos módulos
  modules/
    conversation/           # máquina de estados do pedido (puro) + controller do webhook
      conversation.controller.ts
      conversation.service.ts       # transições, mensagens fixas, decide quando chamar IA
      conversation.repository.ts    # estado da conversa (via infra/cache)
      conversation.states.ts
    customer/               # identificar e cadastrar cliente (RF02, RF03)
      customer.service.ts
      customer.repository.ts        # API RevGás (via lib/revgas)
    catalog/                # produtos, preço, estoque e formas de pagamento (RF04, RF06)
    order/                  # resumo, total, idempotência e criação da venda (RF07, RF08, RF09)
      order.service.ts
      order.repository.ts           # API RevGás + vendas salvas no Postgres
    assistant/              # interpretar() e responderFaq() (RF10)
    handoff/                # transferência para atendente + resumo (RF11)
    metrics/                # painel da revenda (F08)
  infra/
    cache/                  # Redis (ioredis): estado da conversa com TTL
    database/               # Postgres + Drizzle: client, schema, migrations
  lib/
    revgas/                 # cliente HTTP da API RevGás: API Key, retry com backoff, logs mascarados
    whatsapp/               # provedores (Cloud API, Evolution/Z-API) com interface única: texto, lista, botões
    llm/                    # cliente do modelo de IA
```

**Regras de dependência:**
- `modules/` depende de `infra/` e de `lib/`, nunca o contrário.
- `lib/` não conhece o domínio: só fala com o serviço externo e valida as respostas com Zod.
- Os services de um módulo não importam SDKs direto (Redis, Drizzle, `lib/`). Esse acesso passa pelos repositórios.
- Cada cliente de `lib/` tem um mock para os testes (API RevGás, provedor de mensagens e LLM).
- `conversation.service` não faz I/O: recebe o estado e a mensagem, devolve o novo estado e as respostas. Assim o fluxo inteiro pode ser testado com Vitest, sem WhatsApp e sem IA (RNF08).
- Os schemas Zod ficam no módulo que os usa (`*.schema.ts`). As tabelas Drizzle ficam em `infra/database/schema`.

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
  confianca: number       // 0..1; abaixo do limiar → handoff
}
```

> Os tipos e valores de `intencao` são proposta; o documento só lista os campos.

### `responderFaq(pergunta)`

Responde a partir de um FAQ curto (poucas dezenas de perguntas) embutido no prompt. RAG com pgvector só se a base crescer.

**Regras:** saída inválida → perguntar de novo; IA indisponível → voltar aos botões; o prompt nunca recebe a API Key nem dados de outros clientes.

## Integração com a API RevGás

**Autenticação (confirmada):** API Key solicitada ao suporte da RevGás, guardada em variável de ambiente e usada só no backend. Ref.: [Autenticação e Permissão](https://revgas.stoplight.io/docs/revgas-api/en39g0vb0qwsb-autenticacao-e-permissao).

**Operações necessárias** (rotas e campos reais na spec privada, `docs/project/private/revgas-openapi.yaml`, fora do git):

| # | Operação | Quando | O que conferir |
| --- | --- | --- | --- |
| 1 | Buscar cliente por telefone (ou CPF) | Primeira mensagem | Formato do telefone (DDI? só dígitos?) |
| 2 | Cadastrar cliente | Cliente não encontrado | Campos obrigatórios |
| 3 | Listar / atualizar endereços | Confirmação de endereço | Endereço embutido na venda ou por ID |
| 4 | Listar produtos com preço e estoque | Escolha do produto | IDs P13/P45/água; preço por tabela ou por cliente |
| 5 | Listar formas de pagamento | Escolha do pagamento | IDs de dinheiro, Pix, cartão; campo de troco |
| 6 | **Criar venda** | Após "confirmo" | Corpo, campo de origem/canal, retorno (ID, status) |
| 7 | Consultar venda / entrega | "Meu gás chegou?" | Status disponíveis; existe webhook? |

### Rascunho do corpo de "criar venda"

Montado pelo backend; os nomes dos campos são ilustrativos.

```json
{
  "clienteId": "<id do passo 1 ou 2>",
  "enderecoEntrega": { "logradouro": "", "numero": "", "bairro": "", "cidade": "", "referencia": "" },
  "itens": [ { "produtoId": "<id do passo 4>", "quantidade": 1, "valorUnitario": 0 } ],
  "pagamentos": [ { "formaPagamentoId": "<id do passo 5>", "valor": 0, "trocoPara": null } ],
  "observacao": "Pedido via chatbot WhatsApp",
  "origem": "chatbot"
}
```

## Confiabilidade

- **Idempotência:** chave por conversa enviada na criação da venda, mais checagem local de venda igual nos últimos minutos (necessária se a API não aceitar chave de idempotência).
- **Retry:** backoff só em 5xx/timeout. Atenção: retry sem idempotência no servidor pode duplicar a venda.
- **Persistência:** ID da venda salvo no Postgres e enviado ao cliente; falha → alerta no log.
- **Logs:** toda chamada à API RevGás e todo handoff, com CPF e telefone mascarados.

## Dados

| Onde | O quê |
| --- | --- |
| Redis (TTL) | Estado da conversa e carrinho em andamento |
| Postgres | Histórico de conversas, vendas criadas, handoffs, métricas do painel |

## Restrições do canal (WhatsApp)

- Lista interativa: até 10 opções.
- Botões de resposta: até 3 por mensagem.
- Mensagens iniciadas pelo bot fora da janela de 24h (lembrete de recompra, recuperação de carrinho) exigem template aprovado, o que afeta o roadmap.
- A camada de mensageria deve expor uma interface única (enviar texto, lista e botões) e abstrair as diferenças entre os provedores (Cloud API, Evolution/Z-API).
