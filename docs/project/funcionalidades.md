# Funcionalidades — RevGás AI Flow

> Extraído de [revgas-ai-flow.md](revgas-ai-flow.md). Visão do que o cliente final e a revenda conseguem fazer.

## Princípio de design

**A IA entra só onde há texto livre para interpretar; o resto é máquina de estados com mensagens fixas e botões.** Preço, total, validações e criação da venda nunca passam pela IA.

## Escopo da entrega (MVP da disciplina)

| # | Funcionalidade | Descrição | Requisitos |
| --- | --- | --- | --- |
| F01 | Pedido completo pelo WhatsApp | Do "oi" até a venda criada no ERP, com confirmação de produto, endereço e pagamento | RF01–RF08 |
| F02 | Identificação e cadastro automático | Reconhece o cliente pelo telefone; cadastra se for novo | RF02, RF03 |
| F03 | Pedido em texto livre | "manda 2 botijão, pago no pix" → IA extrai tudo e o bot só pergunta o que faltou. **Entregue** (2026-10-22), junto com o fallback de intenção | RF04–RF06 |
| F04 | Repetir último pedido | Cliente conhecido recebe botão com último pedido e endereço; fecha em 2 toques (pula para o resumo, ou para a pergunta de troco se o pagamento for dinheiro). **Entregue** (2026-10-23) | RF02, RF07 |
| F05 | Status do pedido | Nº da venda, entregador a caminho e tempo estimado; consulta "meu gás chegou?". **Pendente** | RF09 |
| F06 | Dúvidas com IA sobre a base | Dúvidas fora do menu (entrega, troca de botijão, segurança) respondidas só com trechos da base da revenda; horário, pagamento e preço vêm do código. Sem resposta, oferece o atendente. **Entregue** (2026-11-10) | RF10 |
| F07 | Handoff para atendente | Transfere a conversa para a fila do Chatwoot com resumo; o bot segue atendendo até o atendente falar. **Entregue** (2026-11-09) | RF11 |
| F13 | RAG sobre a base | Busca híbrida (vetor + texto, fusão RRF) no Postgres com pgvector, corte de relevância e checagens de saída. **Entregue** (2026-11-10) | RF10 |

> **Decisão de escopo (2026-10-22):** o MVP é F01–F05. F03 e o fallback de intenção estão
> implementados; F04 e F05 estavam pendentes. F06, F07, F08, F09, F10, F11, F12, F13 e a RN13
> (salvar venda e conversas no Postgres) viraram melhorias futuras. Depois disso, F04, F12 e F14
> foram entregues em 2026-10-23 (decisão abaixo), F07 em 2026-11-09 e F06 e F13 em 2026-11-10; F05
> continua pendente.
> Ver [requisitos.md](requisitos.md#decisões-2026-10-22).

> **Decisão de escopo (2026-10-23):** F04 (repetir último pedido), F12 (lembrete de pedido parado
> aos 10 minutos) e F14 (verificação de identidade pelos 3 primeiros dígitos do CPF) foram
> entregues e saem das melhorias futuras. Só F05 continua pendente no MVP. Ver
> [requisitos.md](requisitos.md#decisões-2026-10-23).

> **Entregue (2026-11-09):** F07 — handoff para atendente via Chatwoot. Pedido de atendente ou
> falha da venda entra na fila com um resumo; o atendente responde pelo mesmo WhatsApp. Ver
> [chatwoot.md](../guides/integrations/chatwoot.md) e [requisitos.md](requisitos.md#decisões-2026-11-09).

> **Entregue (2026-11-10):** F06 e F13 — dúvidas respondidas pela base de conhecimento (RAG), com
> guard rails: emergência de gás sem IA, recusa de assunto fora do escopo, tratamento de ofensa,
> preço só pelo código e limite de chamadas de IA por telefone. Ver [fluxo.md](fluxo.md#dúvidas-preço-e-guard-rails),
> [knowledge.md](../guides/modules/knowledge.md) e [requisitos.md](requisitos.md#decisões-2026-11-10).

## Melhorias futuras (fora do escopo atual)

Decisão de 2026-10-22: nada desta seção é usado por enquanto. F12 e F14 foram entregues em 2026-10-23, F07 em 2026-11-09 e F06 e F13 em 2026-11-10; saíram daqui.

| # | Funcionalidade | Descrição | Dependência |
| --- | --- | --- | --- |
| F08 | Painel simples para a revenda | Conversas iniciadas, vendas criadas, taxa de conversão | Salvar vendas e conversas no Postgres |
| F09 | Lembrete de recompra | Avisa quando o gás deve estar acabando, pelo intervalo entre compras do cliente | Histórico no Postgres; template aprovado no WhatsApp (fora da janela de 24h) |
| F10 | Pedido por áudio | Transcreve o áudio e segue o mesmo fluxo | Serviço de transcrição |
| F11 | Pesquisa pós-entrega | Nota de 1 a 5 | Webhook/consulta de status "entregue" |
| RN13 | Salvar vendas e conversas no Postgres | ID da venda e histórico guardados no banco próprio, além do ERP | Tabelas e migrations |

## Onde cada funcionalidade usa IA

| Situação | Solução | IA? |
| --- | --- | --- |
| Saudação, menu, status do pedido | Mensagem fixa com variáveis (nome, nº da venda) | Não |
| Escolher produto | Lista interativa do WhatsApp (até 10 opções) | Não |
| Confirmar endereço, pagamento e pedido | Botões de resposta (até 3 por mensagem) | Não |
| Respostas curtas digitadas ("sim", "1", "pix") | Palavra-chave após normalizar (minúsculas, sem acento) | Não |
| CEP, CPF, telefone | Regex + dígito verificador; CEP via ViaCEP | Não |
| Preço, total, troco | Backend com dados da API | **Nunca** |
| Criar a venda | Backend, após o botão "Confirmar" | **Nunca** |
| Pedido em texto livre | IA extrai intenção e entidades em JSON (só quando a etapa não entendeu a mensagem) | Sim |
| Endereço novo digitado sem CEP | IA separa rua, número, bairro e referência; cliente confirma | Sim |
| Dúvida geral (entrega, troca de botijão, segurança) | Busca na base (vetor + texto); a IA redige só com os trechos achados, e a resposta passa por checagens de saída. Sem resposta: "não sei" e oferta de atendente | Sim (embedding e redação) |
| Dúvida de horário | Mensagem montada pelo código com `SERVICE_HOURS`; a IA só classifica | Só classifica |
| Dúvida de forma de pagamento | Lista montada pelo código com as formas ativas da RevGás; a IA só classifica | Só classifica |
| Pergunta de preço | Preço base da RevGás montado pelo código; a IA só classifica | Só classifica |
| Fora do assunto e ofensa | Texto fixo; a IA só classifica. Ofensa repetida oferece o atendente | Só classifica |
| Vazamento ou cheiro de gás | Detector de frases, antes de qualquer comando; texto fixo de segurança e fila do atendente | **Nunca** |
| Mensagem que não bate com nada | IA classifica a intenção; confiança baixa → "Não entendi." e repete a pergunta com os botões; 3 seguidas oferecem o atendente | Sim |
| Limite de uso da IA | Contador por telefone no Redis (`AI_CALLS_PER_PHONE_HOUR`); acima dele o bot segue sem IA | Não |
| Pedido de atendente | Entra na fila do Chatwoot (sem Chatwoot: telefone da revenda) | Não |
| Pedido de desconto | Mensagem fixa ("o preço é o da tabela") | Não |

## Técnicas de IA — decisão por técnica

| Técnica | Uso | Decisão |
| --- | --- | --- |
| Intent Classification | Só quando a mensagem não bate com botão/palavra-chave | Essencial (fallback) |
| Entity Extraction | Produto, quantidade, endereço e pagamento em texto livre | Essencial |
| Guardrails | JSON validado; IA não define preço nem cria venda; emergência de gás sem IA; recusa de fora do assunto; ofensa; limite de chamadas por telefone; checagens de saída da resposta | Entregue |
| Human Handoff | Pedido do cliente, falha da API, emergência, "não sei" e cliente travado (Chatwoot, F07) | Entregue |
| Conversation Memory | Máquina de estados no Redis, não o modelo | Sem IA |
| Tool Calling | Quem chama a API é o backend | Não usar |
| RAG híbrido | Busca por vetor + texto com fusão RRF e corte de relevância (F13) | Entregue |
| Reranking | Não usado: o corte de relevância e as checagens bastam por enquanto | Fora do escopo |
| Query Rewriting, Multi-Query, HyDE, HyPE | Ganho pequeno | Fora do escopo |
| Text-to-SQL, GraphRAG, Agentic RAG | Não servem para criar venda | Fora do escopo |
