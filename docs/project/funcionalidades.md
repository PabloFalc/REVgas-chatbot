# Funcionalidades — RevGás AI Flow

> Extraído de [revgas-ai-flow.md](revgas-ai-flow.md). Visão do que o cliente final e a revenda conseguem fazer.

## Princípio de design

**A IA entra só onde há texto livre para interpretar; o resto é máquina de estados com mensagens fixas e botões.** Preço, total, validações e criação da venda nunca passam pela IA.

## Escopo da entrega (MVP da disciplina)

| # | Funcionalidade | Descrição | Requisitos |
| --- | --- | --- | --- |
| F01 | Pedido completo pelo WhatsApp | Do "oi" até a venda criada no ERP, com confirmação de produto, endereço e pagamento | RF01–RF08 |
| F02 | Identificação e cadastro automático | Reconhece o cliente pelo telefone; cadastra se for novo | RF02, RF03 |
| F03 | Pedido em texto livre | "manda 2 botijão, pago no pix" → IA extrai tudo e o bot só pergunta o que faltou | RF04–RF06 |
| F04 | Repetir último pedido | Cliente conhecido recebe botão com último pedido e endereço; fecha em 2 toques (pula para o resumo) | RF02, RF07 |
| F05 | Status do pedido | Nº da venda, entregador a caminho e tempo estimado; consulta "meu gás chegou?" | RF09 |
| F06 | FAQ com IA | Dúvidas fora do menu (horário, garantia, vale-gás) respondidas a partir de FAQ curto | RF10 |
| F07 | Handoff para atendente | A qualquer momento, por pedido do cliente, confiança baixa ou falha da API; leva resumo da conversa | RF11 |
| F08 | Painel simples para a revenda | Conversas iniciadas, vendas criadas, taxa de conversão, handoffs | RNF05 |

## Roadmap (pós-MVP)

| # | Funcionalidade | Descrição | Dependência |
| --- | --- | --- | --- |
| F09 | Lembrete de recompra | Avisa quando o gás deve estar acabando, pelo intervalo entre compras do cliente | Histórico no Postgres; template aprovado no WhatsApp (fora da janela de 24h) |
| F10 | Pedido por áudio | Transcreve o áudio e segue o mesmo fluxo | Serviço de transcrição |
| F11 | Pesquisa pós-entrega | Nota de 1 a 5; nota baixa abre handoff | Webhook/consulta de status "entregue" |
| F12 | Recuperação de carrinho | Mensagem de retomada se o cliente parou no meio | Job agendado antes do TTL do Redis expirar |
| F13 | RAG sobre o FAQ | pgvector + reranking, só se o FAQ ficar grande demais para o prompt | Base de FAQ crescer |

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
| Pedido em texto livre | IA extrai intenção e entidades em JSON | Sim |
| Endereço novo digitado sem CEP | IA separa rua, número, bairro e referência; cliente confirma | Sim |
| Dúvida fora do menu | IA responde a partir do FAQ no prompt | Sim |
| Mensagem que não bate com nada | IA classifica a intenção; confiança baixa → handoff | Sim |
| Passar para o atendente | IA resume a conversa em 2 linhas | Opcional |

## Técnicas de IA — decisão por técnica

| Técnica | Uso | Decisão |
| --- | --- | --- |
| Intent Classification | Só quando a mensagem não bate com botão/palavra-chave | Essencial (fallback) |
| Entity Extraction | Produto, quantidade, endereço e pagamento em texto livre | Essencial |
| Guardrails | JSON validado; IA não define preço nem cria venda | Essencial |
| Human Handoff | Confiança baixa, falha da API ou pedido do cliente | Essencial (sem IA; resumo opcional) |
| Conversation Memory | Máquina de estados no Redis, não o modelo | Sem IA |
| Tool Calling | Quem chama a API é o backend | Não usar |
| RAG híbrido + Reranking | Só se o FAQ crescer | Futuro |
| Query Rewriting, Multi-Query, HyDE, HyPE | Ganho pequeno | Fora do escopo |
| Text-to-SQL, GraphRAG, Agentic RAG | Não servem para criar venda | Fora do escopo |
