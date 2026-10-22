# Design — Fluxo de pedido pelo WhatsApp (máquina de estados)

Data: 2026-10-21 · Status: rascunho para aprovação

## Intenção

Trocar a resposta de teste do bot (eco, "lista", "botões") pelo **pedido de verdade**: do "oi" até a
venda criada na RevGás. É a primeira entrega do produto (F01 + F02 de `docs/project/funcionalidades.md`).

O critério principal do usuário é **manutenção**: quem abrir um arquivo precisa saber exatamente o que
vai encontrar nele e entender o que ele faz sem caçar lógica em outros lugares. Simples, enxuto e
funcional vale mais que flexível.

## Decisões do usuário

- **Sem atendente humano.** Pedido de atendente → mensagem fixa com o telefone da revenda.
- **CPF obrigatório.** Cliente novo informa; cliente cadastrado sem CPF informa antes de seguir.
- **Sem limite de quantidade** (inteiro ≥ 1).
- **Sem promoção nem desconto.** Pedido de desconto → resposta fixa.
- **Nomes do código em inglês; textos do bot em português.**
- **Todos os textos do bot num arquivo só.** Se passar de 500 linhas, avisar o usuário.
- **Endereço:** o cliente manda **CEP** ou **texto livre**.
  - Só CEP → consultamos (ViaCEP), completamos o que falta e mostramos para ele confirmar.
  - Texto livre → nós separamos os campos (IA), conferimos e mostramos para ele confirmar.
  - Sempre há confirmação do cliente antes de usar o endereço.
- **Cliente cadastrado não digita endereço:** escolhe entre os endereços conhecidos ou "Outro endereço".
  Endereços conhecidos = cadastro da RevGás + endereços das vendas anteriores dele, sem repetir. Não há
  tabela própria de endereços.
- **Sem verificação de identidade no MVP** (risco registrado em `requisitos.md`; roadmap F14).
- **Produto:** lista; se a revenda tiver mais de 10 produtos, a lista ganha "Buscar pelo nome".
- **Troco:** perguntado no pagamento em dinheiro; vai na `observation` da venda.
- **"Corrigir" no resumo:** o cliente escolhe o que corrigir e volta só àquela etapa.
- **Nome do cliente novo:** digitado por ele (nome completo), não o nome do perfil do WhatsApp.
- **Pedido em andamento expira em 15 minutos** sem resposta.
- **Fora desta entrega:** F04 (repetir último pedido) e F05 (status "meu gás chegou?").
- **Etapas recebem ferramentas (`FlowTools`)** em vez de serem funções puras (ver "Como o código se
  organiza").

## Objetivos

- Cliente novo: cadastro (nome, CPF, endereço) → produto → quantidade → pagamento → resumo → venda.
- Cliente cadastrado: escolhe endereço → produto → quantidade → pagamento → resumo → venda.
- Cada etapa num arquivo próprio, com o mesmo formato; textos num arquivo só.
- Toda a decisão do fluxo testável sem WhatsApp, sem Redis, sem RevGás real e sem IA.
- O fluxo nunca trava por causa da IA (RNF06): se a IA falhar, pedimos o CEP.

## Não objetivos

- F04, F05, F06 (FAQ), F07 (handoff), F08 (painel), F14 (verificação de identidade).
- IA em qualquer outra etapa além do endereço em texto livre.
- Mais de um produto por pedido; mais de uma forma de pagamento por pedido.
- Salvar vendas ou conversas no Postgres (RN13 fica para a rodada do painel).
- Mudar o endereço do cadastro do cliente cadastrado quando ele usa "Outro endereço".

## Anti-objetivos (falha mesmo se "funcionar")

- Criar **duas vendas** para uma confirmação (toque duplo, mensagem repetida, "Tentar de novo").
- Criar venda sem o cliente ter tocado em **Confirmar** no resumo.
- Preço ou total vindo do texto do cliente ou da IA (RN06, G05).
- CPF, telefone ou endereço em log sem máscara; CPF no prompt da IA (RNF03, G02).
- Lógica do fluxo espalhada: para entender uma etapa, abrir mais de um arquivo de etapa.
- Uma mensagem fora de contexto (botão antigo, texto aleatório) quebrar o fluxo ou levar a outra etapa.

## A conversa

### Início

O bot busca o cliente pelo telefone na RevGás.

| Situação | Próximo passo |
| --- | --- |
| Não encontrado | Cadastro |
| Encontrado sem CPF | Pede o CPF, atualiza o cadastro, segue para o endereço |
| Encontrado com CPF | Escolha do endereço |

### Cadastro (cliente novo)

```
Olá! Ainda não te conhecemos. Para fazer seu pedido, preciso de alguns dados.
Qual é o seu nome completo?
→ Maria da Silva
Agora seu CPF (só números):
→ 123.456.789-09
Qual o endereço de entrega? Mande o CEP ou o endereço completo.
→ (fluxo de endereço novo, com confirmação)
```

- Nome: pelo menos duas palavras; senão pede de novo.
- CPF: aceita com ou sem pontuação; confere o dígito verificador; inválido → pede de novo **sem repetir
  o número** na mensagem.
- O cliente é criado na RevGás **assim que o endereço é confirmado**, antes do produto.

### Escolha do endereço (cliente cadastrado)

```
Para onde vai o gás?
[Rua das Flores, 120 – Centro] [Av. Frei Serafim, 900 – Centro] [Outro endereço]
```

- Até 2 endereços conhecidos → botões; mais → lista (até 9 endereços + "Outro endereço").
- Sem nenhum endereço conhecido → vai direto para o endereço novo.

### Endereço novo

Campos que a venda exige: rua, número, bairro, cidade, UF. Opcionais: complemento, referência, CEP.

- **Só CEP** (8 dígitos, com ou sem traço): consulta o ViaCEP → pergunta o número (e complemento ou
  referência, opcional) → confirmação. CEP não encontrado → avisa e pede o CEP de novo ou o endereço
  completo.
- **Texto livre**: a IA separa os campos. Se houver CEP no texto, confere no ViaCEP. Faltou campo
  obrigatório → pergunta só o que faltou. Depois → confirmação.
- **IA falhou ou demorou** → "Não consegui entender. Me manda o CEP?" e segue pelo CEP.
- **Confirmação:**
  ```
  É esse o endereço?
  Rua das Flores, 120 – Centro, Teresina/PI
  [Está certo] [Corrigir]
  ```
  "Corrigir" → pede o CEP ou o endereço completo de novo.

### Produto e quantidade

- Lista dos produtos à venda. Ficam de fora os inativos, os sem estoque e os sem preço nos acordos.
- Até 10 produtos → todos na lista. Mais de 10 → 9 produtos + "Buscar pelo nome".
  - Ordem: primeiro os que o cliente já comprou, depois ordem alfabética.
  - Busca: o cliente digita parte do nome; comparamos sem maiúsculas e sem acento; mostramos os
    encontrados (até 10). Nada encontrado → avisa e pede outro nome.
- O preço **não** aparece na lista (depende da forma de pagamento).
- Quantidade: **[1] [2] [Outra]**. "Outra" → pede um inteiro ≥ 1.

### Pagamento

- Formas ativas da revenda na RevGás, com nomes em português ("Pix", "Dinheiro", "Cartão de crédito"…).
  Até 3 → botões; mais → lista.
- Com a forma escolhida, calculamos preço unitário e total (ver "Preço").
- **Dinheiro:**
  ```
  Total: R$ 220,00. Vai precisar de troco?
  [Não preciso] [Sim]
  → Sim: "Troco para quanto?"   (aceita "250", "250,00", "R$ 250")
  ```
  Valor precisa ser maior que o total; senão pede de novo. Vai na `observation`: "Troco para R$ 250,00".

### Resumo

```
Confira seu pedido:
2× Botijão P13
Rua das Flores, 120 – Centro
Dinheiro (troco para R$ 250,00)
Total: R$ 220,00
[Confirmar] [Corrigir]
```

- **Corrigir** → `[Produto] [Endereço] [Pagamento]`. O cliente refaz só aquela etapa (produto inclui a
  quantidade) e **volta direto ao resumo**. Mudou o total → recalcula; se for dinheiro e o troco ficou
  menor que o novo total → pergunta o troco de novo.
- **Confirmar** → cria a venda.
  - Sucesso → "Pedido nº 4521 confirmado! Já estamos separando seu gás." e o pedido em andamento é
    apagado. A próxima mensagem começa um pedido novo.
  - Falha → "Não consegui registrar seu pedido agora." **[Tentar de novo]**. Antes de tentar de novo,
    conferimos na RevGás se a venda foi criada mesmo assim (timeout). Se foi, mostramos o número dela.

### Em qualquer etapa

| Cliente manda | Bot faz | Etapa |
| --- | --- | --- |
| "cancelar" | "Pedido cancelado. É só mandar mensagem quando quiser pedir." | Apaga o pedido |
| "atendente", "falar com alguém"… | Telefone da revenda | Não muda |
| "desconto", "promoção", "mais barato"… | "O preço é o da tabela da revenda." + repete a pergunta | Não muda |
| Áudio, foto, figurinha… | "Por enquanto só entendo texto e os botões." + repete a pergunta | Não muda |
| Texto ou botão que não serve para a etapa | Repete a pergunta da etapa | Não muda |

Palavras-chave são comparadas depois de normalizar o texto (`normalizeText`: minúsculas, sem acento).

## Preço

- Vem só dos **acordos** da RevGás (`deals`), usando o `suggested_value`. Nunca do cliente nem da IA.
- Todo acordo é ligado a uma forma de pagamento. Para um produto e uma forma de pagamento, a
  prioridade é **cliente > categoria do cliente (`tag_id`) > padrão (`is_default`)**. Essa prioridade é
  suposta (pendente com a Flow); fica numa função pura só dela, para trocar fácil.
- "Produto sem preço" (some da lista) = sem nenhum acordo aplicável ao cliente em nenhuma forma de
  pagamento ativa.
- Total = preço unitário × quantidade, calculado no backend.

## Como o código se organiza

### Ideia central

O **fluxo** (o que perguntar, o que aceitar, para onde ir) fica separado de **como** os dados são
buscados e as mensagens enviadas.

- Cada etapa é uma função `(estado, entrada, ferramentas) → { estado novo, respostas }`.
- As **ferramentas** (`FlowTools`) são uma interface com as poucas operações que o fluxo precisa
  ("buscar cliente pelo telefone", "consultar CEP", "criar venda"…). Em produção, elas chamam RevGás,
  ViaCEP e IA; nos testes, são um objeto fake simples.
- As etapas não conhecem WhatsApp, Redis, HTTP nem SDKs: recebem uma mensagem já traduzida e devolvem
  respostas no formato `Reply` que já existe.

> **Mudança de regra do projeto (aprovada pelo usuário).** O `CLAUDE.md` hoje diz que a decisão é uma
> função **pura** e sem I/O. Com consultas no meio do fluxo (CEP, IA, preço), a função pura exigiria um
> vai-e-volta de "pedidos de ação" entre fluxo e serviço, mais difícil de ler. Este design troca "pura"
> por "**sem dependências concretas**": as etapas são `async` e recebem `FlowTools`. Continua testável
> sem WhatsApp, IA nem RevGás (RNF08). O `CLAUDE.md` é atualizado junto.

### Arquivos

```
src/modules/conversation/
  conversation.controller.ts   (existe) webhook
  conversation.service.ts      recebe o evento → carrega o pedido → roda o fluxo → salva → envia
  conversation.repository.ts   deduplicação (existe) + pedido em andamento no Redis (TTL 15 min)
  messaging.gateway.ts         (existe) envia pelo WhatsApp
  flow/
    flow.ts                    porta de entrada: comandos globais, depois chama a etapa atual
    flow.types.ts              OrderState, FlowInput, FlowResult, FlowTools
    messages.ts                todos os textos do bot (português)
    global-commands.ts         cancelar, atendente, desconto, mensagem não suportada
    steps/
      customer.step.ts         início, nome, CPF
      address.step.ts          escolher endereço, CEP/texto, campos faltando, confirmação
      product.step.ts          lista, busca, quantidade
      payment.step.ts          forma de pagamento, troco
      summary.step.ts          resumo, correção, criar venda, tentar de novo
  flow-tools.ts                implementação de FlowTools usando os repositórios/gateways abaixo

src/modules/customer/customer.repository.ts   RevGás: buscar por telefone, criar, salvar CPF, endereços
src/modules/catalog/catalog.repository.ts     RevGás: produtos, formas de pagamento, acordos
src/modules/catalog/price.ts                  função pura: escolhe o acordo e calcula o total
src/modules/order/order.repository.ts         RevGás: criar venda, achar venda recente (anti-duplicata)
src/modules/address/address.service.ts        CEP (ViaCEP) e texto livre (IA) → endereço
src/integrations/viacep/                      cliente ViaCEP, modos live/fake (como as outras integrações)
src/utils/cpf.ts                              validação de CPF (dígito verificador)
```

Regra de leitura: **um arquivo de etapa por assunto da conversa**. Cada um começa pelos estados que
ele trata e tem, para cada estado, uma função `ask…` (o que o bot pergunta ao entrar) e uma função
`handle…` (o que fazer com a resposta). Tamanho esperado: até ~200 linhas por arquivo.

Os nomes de módulos (`customer`, `catalog`, `order`, `address`) seguem a estrutura planejada em
`docs/project/specs.md`; `assistant` não é criado agora, o prompt do endereço mora em `address/`.

### Estado do pedido (`OrderState`, no Redis)

Guarda a etapa atual e o que já foi escolhido, com IDs **e** os textos para mostrar (evita buscar de
novo só para escrever o resumo). Inclui um marcador "voltando para o resumo" para a correção.
Chave por telefone; TTL de 15 minutos renovado a cada mensagem; apagado ao concluir ou cancelar.

### IDs dos botões

Prefixados pelo assunto (`address:2`, `product:123`, `qty:1`, `pay:PIX`, `summary:confirm`…). Uma
etapa só aceita os IDs do seu assunto e que existam no estado atual; o resto cai em "repete a pergunta".

## Falhas fora da criação da venda (decisões do assistente)

- **Leitura da RevGás falhou** (cliente, produtos, preço, formas de pagamento): "Estou com
  instabilidade agora, tenta de novo em instantes." O pedido em andamento é mantido; a próxima mensagem
  repete a etapa.
- **Cadastro recusado porque o CPF já existe em outro cliente** (409 da RevGás): "Esse CPF já tem
  cadastro com outro telefone. Fale com a revenda: <telefone>." Não reaproveitamos o cadastro existente
  (seria entregar dados de um cliente a outro telefone).
- **Outro erro ao cadastrar** (422 etc.): pede para conferir os dados e volta ao nome.
- **Estoque:** se a revenda tem `ignore_stock_check = true`, o estoque não é usado para esconder produto.

## Garantias contra venda duplicada

- O webhook já deduplica mensagens repetidas da Meta (existe).
- "Confirmar" só cria venda no estado de resumo; ao começar a criar, o estado muda para "criando", então
  um segundo toque em "Confirmar" não cria outra.
- Mensagens do mesmo telefone são processadas **uma por vez** (trava curta no Redis por telefone), para
  dois toques rápidos não lerem o mesmo estado.
- Nunca há retry automático de criar venda (regra do guia da RevGás). "Tentar de novo" primeiro procura
  uma venda recente do cliente pelo WhatsApp (`GET /sales?customer_id&channel=WHATSAPP&from=`) com o
  mesmo total; se achar, considera criada.

## Restrições conhecidas

- **RevGás: 1 requisição por segundo** por chave, e listar todos os acordos leva ~18 s (1201 acordos na
  conta de teste). Produtos, formas de pagamento e acordos padrão/categoria precisam de **cache no Redis**
  (sugestão: 10 min); acordos do cliente são buscados filtrados por `customer_id`.
- A RevGás tem só produção (homologação "não utilizar"): testes locais usam o modo `fake`/`hybrid` já
  existente; criar venda real só em teste manual combinado.
- Telefone: o WhatsApp manda com 55; a busca de cliente aceita 10–11 dígitos; o cadastro exige com 55.
- Lista do WhatsApp: até 10 linhas, título da linha até 24 caracteres; botão: até 3, título até 20.
  Textos longos (endereço, nome do produto) precisam ser encurtados (`truncate`) no título e completos
  na descrição.

## Ficam com quem implementar

- Cidade/UF quando o texto livre não traz: usar a da revenda (variável de ambiente) e deixar o cliente
  corrigir na confirmação.
- Vários cadastros com o mesmo telefone: usar o de venda mais recente.
- Quantas vendas anteriores ler para montar os endereços (sugestão: as 20 mais recentes).
- Nome exato das variáveis de ambiente novas (telefone da revenda, cidade/UF padrão, URL do ViaCEP).
- Formato interno do `OrderState` e das funções de etapa, desde que siga a regra de leitura acima.

## Testes

- **Um arquivo de teste por arquivo de etapa**, escrito como conversas: "dado o estado X, quando o
  cliente manda Y, o bot responde Z e vai para W". Usa um `FlowTools` fake.
- `flow.spec.ts`: conversas completas de ponta a ponta (cliente novo; cliente cadastrado; correção;
  falha e "Tentar de novo"; cancelar; comandos globais).
- `price.spec.ts`, `cpf.spec.ts`, cliente ViaCEP (live com HTTP simulado e fake), `address.service`
  (IA falhando → pede CEP).
- E2e do webhook: uma conversa curta com WhatsApp, RevGás e IA em modo fake.

## Documentação a atualizar

- `CLAUDE.md`: estrutura do `conversation/flow`, a regra "sem dependências concretas" no lugar de "pura".
- `docs/project/fluxo.md`: estados reais e a conversa desta entrega.
- `docs/guides/conventions/environment.md`: variáveis novas.
- Guia da integração ViaCEP em `docs/guides/integrations/`.
