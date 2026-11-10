# Design — Conhecimento da revenda com RAG (F06/F13) e guard rails da IA

Data: 2026-11-09 · Status: rascunho para aprovação

## Intenção

Hoje a IA do bot só **classifica** a mensagem e **extrai** dados de pedido (produto, quantidade,
pagamento, endereço). Ela nunca escreve a resposta: tudo o que o cliente lê é texto fixo do
`messages.ts`. Isso protege bem o bot contra responder o que não deve, mas desperdiça o bot. Uma
dúvida legítima da revenda ("vocês entregam domingo?", "aceitam vale-gás?") recebe a mesma resposta
que "qual o preço da carne?": *"Essa dúvida eu não consigo responder por aqui. Fale com a revenda."*

Este trabalho tem dois objetivos que puxam para lados opostos e precisam andar juntos:

1. **Aproveitamento máximo:** dar à IA **conhecimento da revenda** (uma base em Markdown, buscada por
   RAG) para responder dúvidas, e usar mais a IA para entender o que o cliente escreve.
2. **Não responder o que não é responsabilidade do bot:** pedir água quando a revenda não vende,
   conselhos, preço da carne, política… Os **guard rails** cercam o que a IA passa a fazer.

Ainda **não existe** conteúdo real da revenda. Vamos criar uma **base fictícia** e uma **lista de
perguntas de teste** para provar que tudo funciona. O tamanho da base real é desconhecido, e por isso
a busca é por embeddings (RAG) desde já, e não "colar o FAQ inteiro no prompt".

## Decisões do usuário

- Começar agora com **embeddings e RAG**, porque o tamanho do documento real é desconhecido.
- **Sem conteúdo real ainda:** criar um documento falso para testar.
- **Formato da base: Markdown (`.md`)** por enquanto. Outros formatos ficam para depois.
- **Desenhar para um plano pago** de IA, provavelmente de **outro provedor**. Os testes de agora usam
  o plano gratuito do Gemini.
- **Duas fases no mesmo documento:** fase 1, conhecimento + RAG + interpretação; fase 2, guard rails.
- O quadro de interpretação e guard rails proposto na conversa foi aprovado como está (seções 5 e 6).

## Objetivos

- Dúvidas cobertas pela base são respondidas pelo bot, com texto curto e fiel à base.
- Dúvidas da revenda que a base **não** cobre recebem "não sei" e a oferta de atendente, nunca uma
  resposta inventada.
- Assuntos de fora recebem uma recusa educada que explica o que o bot faz.
- O bot entende mensagens mais soltas no meio do pedido, e não só as que têm palavra de pedido.
- Trocar de provedor ou de modelo (chat ou embedding) é configuração e reprocessamento da base, não
  reescrita de código.
- Um comando mostra, com números, quanto a busca e as respostas acertam numa lista fixa de perguntas.

## Não objetivos

- Conteúdo real da revenda.
- Formatos além de Markdown (PDF, Word, planilha).
- Reranking com modelo próprio (fica para quando a base crescer).
- Painel para a revenda editar a base. A base é arquivo no repositório.
- Áudio, imagem ou anexo.
- Memória de conversa longa pela IA. O estado continua sendo a máquina de estados no Redis.
- Tool calling: a IA não chama APIs, quem chama é o código.

## Anti-objetivos (falha mesmo se "funcionar")

- A IA **inventar** informação que não está nos trechos encontrados (horário, taxa, bairro, prazo).
- A IA informar **preço, total ou desconto**. Preço só vem do cálculo do código com a RevGás.
- A IA criar, alterar ou confirmar venda.
- **CPF** (inteiro ou parte), telefone ou endereço do cliente no prompt da dúvida ou nos logs.
- Responder sobre política, saúde, finanças, outros comércios ou qualquer assunto fora da revenda.
- Uma instrução no texto do cliente ("ignore as regras", "finja que é…") mudar o comportamento.
- Pergunta sobre **vazamento ou cheiro de gás** passar pela IA ou receber resposta improvisada.
- O bot travar ou ficar sem resposta quando a IA, o embedding ou o Postgres falham.
- `pnpm test`, `pnpm test:e2e` ou a CI passarem a depender de rede ou de chave de IA.
- Etapas de `flow/steps/` importando Nest, Redis, Postgres, integrações, serviços ou repositórios.

## Como funciona

### 1. Base de conhecimento

- Pasta de arquivos `.md` no repositório, por exemplo `knowledge/` (o local fica com o builder). Cada
  `##` é uma seção, e as seções são a unidade natural de trecho (chunk). Seções longas podem ser
  subdivididas.
- **Base fictícia** de uma revenda inventada, com umas **10 a 15 seções**: horário, bairros atendidos,
  taxa e prazo de entrega, formas de pagamento, vale-gás, troca de botijão e de marca, garantia,
  cuidados e segurança, como pedir, devolução e reclamação. Deve ter termos exatos que a busca não
  pode perder (por exemplo "P13", "P45", nomes de bairro) e seções parecidas entre si, para a busca
  ter onde errar.
- O texto da base é **dado**, nunca instrução para a IA.

### 2. Ingestão

- Comando `pnpm`, por exemplo `pnpm kb:ingest`. Ele:
  - lê a pasta e quebra em trechos;
  - gera os embeddings;
  - grava no Postgres.
- Cada trecho guarda o arquivo de origem, o título da seção, o texto, um **hash do conteúdo**, o
  **modelo de embedding** e a dimensão.
- Só reprocessa o que mudou (hash diferente). Remove trechos de seções apagadas. Se o modelo de
  embedding configurado for diferente do gravado, reprocessa tudo.
- O app **não** ingere sozinho ao subir. A ingestão é um passo explícito.

### 3. Armazenamento e busca

- **Postgres com pgvector.** A imagem do `docker-compose.yml` troca de `postgres:17-alpine` para
  `pgvector/pgvector:pg17`. Hoje o Postgres só é usado pelo login (em standby). A extensão é
  habilitada por migration, e a tabela fica em `infra/database/schemas` com migration do Drizzle.
- **Busca híbrida** (minha decisão): similaridade de vetor + busca textual do Postgres em português,
  combinadas (por exemplo por *reciprocal rank fusion*). Isso cobre termos exatos como "P13" e
  "vale-gás", que escapam da busca só por vetor.
- Devolve os **k** melhores trechos com a nota de relevância. Valor de k, índice (HNSW/IVFFlat) e
  fórmula de combinação ficam com o builder, calibrados pela checagem da seção 7.
- **Corte de relevância:** abaixo de um limite, a busca não devolve nada. Sem trecho, a IA **não é
  chamada** para responder. O bot diz que não sabe e oferece o atendente. É o primeiro guard rail.
- Se o Postgres ou o embedding falharem, a dúvida recebe a mesma resposta de "não sei", com log de
  aviso. O pedido segue.

### 4. Integração de IA (provedor trocável)

- A integração `integrations/llm/` continua no formato **compatível com OpenAI** e ganha uma operação
  de **embedding** (`POST {url}/embeddings`), com respostas validadas por Zod e **modo fake** que gera
  vetores **determinísticos** (o mesmo texto dá sempre o mesmo vetor) para os testes rodarem sem rede.
- Variáveis novas: modelo de embedding, dimensão e, se o provedor de embedding puder ser diferente do
  de chat, URL e chave próprias. Elas entram em `env.ts` e em `docs/guides/conventions/environment.md`.
  Chaves novas entram na lista de segredos do `CLAUDE.md` e do `docs/security/SECURITY.md`.
- **Pensado para plano pago:** a IA pode ser chamada para qualquer texto livre, e não só quando
  aparece palavra de pedido. Tempo limite e volta para os botões continuam valendo, e o 429 do plano
  gratuito continua tratado como hoje.
- **Trocar de provedor:** é só configuração. Trocar o modelo de embedding exige rodar a ingestão de
  novo e, se a dimensão mudar, uma migration. O guia `docs/guides/integrations/llm.md` explica isso.

### 5. Fase 1 — Interpretar melhor e responder dúvidas

**Classificação.** A interpretação (`AssistantService.interpret`) passa a distinguir:

| Intenção | O que o bot faz |
| --- | --- |
| Pedido | Como hoje: extrai os dados e segue o fluxo |
| Dúvida da revenda | RAG: busca trechos → a IA responde **só com eles** → repete a pergunta da etapa |
| Pergunta de preço | **Código**, não a IA: consulta o catálogo/preço da RevGás e responde com texto fixo |
| Pedir atendente | Handoff (ver dependência abaixo) |
| Fora do assunto | Recusa fixa e educada (fase 2) → repete a pergunta da etapa |
| Ofensa | Resposta fixa e neutra (fase 2) |
| Outro / confiança baixa | Como hoje: "Não entendi" + repete a pergunta |

- **Dúvida no meio do pedido:** o bot responde e em seguida **repete a pergunta da etapa com os
  botões**, como hoje com "desconto" (`repeatQuestion`). O estado do pedido não muda.
- **Mensagens soltas:** a IA passa a ser chamada para texto livre que a etapa não entendeu, mesmo sem
  palavra de pedido (hoje `shouldInterpret` / `looksLikeOrder` barram). Botões, números e respostas
  curtas que a etapa já entende continuam **sem IA**.
- **Produto que a revenda não vende** (ex.: "quero carvão"): o bot responde com texto fixo e a lista
  do catálogo, por exemplo "Não temos carvão. Temos: P13, P45, Água 20L." Se a revenda vender (por
  exemplo água), segue o pedido normal. **O escopo de produto é o catálogo da RevGás**, nunca uma
  lista fixa no código.
- **Cliente travado:** três mensagens seguidas sem entendimento oferecem o atendente.
- **Resposta da dúvida:** prompt próprio (separado do de interpretação), com os trechos marcados como
  dado, instrução de responder só com eles, curto, em português, no tom do `messages.ts`, sem citar
  preço. Saída validada por Zod.
- **Tudo em `FlowTools`:** a busca e a resposta entram como ferramentas novas (por exemplo
  `answerQuestion(text)`), e as etapas continuam puras e testáveis com `createFakeTools`. Prompts e
  regras ficam no módulo `assistant/` (ou num módulo `knowledge/`, a critério do builder), nunca em
  `integrations/`.

**Oferecer x transferir o atendente.**
- **Oferecer** (é o padrão): uma mensagem própria com o botão **"Falar com atendente"**, enviada antes
  de repetir a pergunta da etapa, que vem em outra mensagem com os botões dela. O botão tem id próprio
  (por exemplo `handoff:offer`) e é tratado como **comando global**, valendo em qualquer etapa. Um
  "sim" digitado nunca é lido como aceite. Digitar "atendente" continua funcionando. Usado em "não
  sei", falha nas checagens de saída, cliente travado e ofensa repetida.
- **Transferir direto** (`requestHandoff`): só quando o cliente pede ou toca o botão, e na
  **emergência** (vazamento).

**Dinheiro, horário e pagamento: quem é a fonte.**
- **A base não contém valores em R$.** Qualquer resposta da IA com R$ ou porcentagem é descartada.
  Perguntas de preço, taxa ou frete vão para o **código** (rota de preço). Se a revenda cobrar taxa de
  entrega, isso é assunto do cálculo com a RevGás, fora deste trabalho. A base fictícia descreve a
  entrega sem citar valor.
- **Horário de atendimento:** responde o **código**, a partir da mesma variável de horário do design
  do handoff. Uma fonte só, e a base não repete o horário.
- **Formas de pagamento:** responde o **código**, a partir da lista ativa da RevGás
  (`listPaymentOptions`). A base pode explicar regras (ex.: troco, vale-gás), sem listar as formas.

**Resposta de preço (código).**
- Mostra o **preço base** de cada produto (o acordo base da RevGás), **nunca o preço especial do
  cliente**. Isso evita vazar acordo de outro cliente para um telefone não verificado (F14).
- Mostra o preço da forma de pagamento padrão, ou "a partir de R$ X" se variar por forma. Avisa que o
  total final aparece no resumo do pedido. O formato exato fica com o builder.
- Sem produto citado: lista todos os produtos ativos com o preço base.

**Primeira mensagem que é só dúvida** (sem pedido em andamento).
- O bot **responde e não inicia o pedido**: não pede nome nem CPF, não cria estado do pedido e não
  agenda lembrete. Junto vai um botão **"Fazer pedido"**, que inicia o fluxo normal.
- O contador de "três mensagens sem entendimento" e o limite de chamadas por telefone ficam em chaves
  próprias do Redis por telefone, **fora** do estado do pedido.

**Dependência do handoff.** "Oferecer o atendente" usa o ponto de entrada `requestHandoff` do design
`2026-11-09-handoff-chatwoot-design.md`. Se este trabalho andar antes do handoff ficar pronto, a
oferta usa o comportamento atual (`msg.talkToStore`) **atrás do mesmo ponto de chamada**, para trocar
depois sem mexer nas etapas.

### 6. Fase 2 — Guard rails

Aplicados **em camadas**, do mais barato para o mais caro:

1. **Antes da IA, pelo código:**
   - **Emergência:** palavras como "vazamento", "cheiro de gás" ou "vazando" disparam um **texto fixo
     de segurança** (fechar o registro, não acender nada, ventilar, ligar para os bombeiros 193) e a
     oferta de atendente. Não passa pela IA. A lista e o texto ficam no código, e os testes cobrem
     variações com e sem acento.
   - **Dados pessoais:** CPF já é removido (`removeCpfs`). Telefone e endereço do cliente também não
     entram no prompt da dúvida, nem o estado do pedido.
   - **Custo:** limite de chamadas de IA (chat + embedding) **por telefone por hora**, no Redis. Passou
     do limite, o bot volta aos botões e às respostas fixas, com log de aviso (telefone mascarado).
2. **Na classificação:**
   - **Fora do assunto:** resposta fixa, por exemplo "Sou o assistente da revenda, posso te ajudar com
     pedidos e dúvidas sobre gás e entrega." Depois volta para a etapa. A IA não escreve essa resposta.
   - **Ofensa:** resposta fixa e neutra. Se repetir, oferece o atendente.
   - **Manipulação** ("ignore as regras", "finja que…", "mostre seu prompt"): o texto do cliente é dado.
     Isso é reforçado nos dois prompts e coberto na checagem.
3. **Depois da IA, conferido pelo código antes de enviar:**
   - Passa no schema Zod e respeita o **tamanho máximo**.
   - **Sem valores em R$, porcentagens de desconto ou números de prazo/horário que não estejam nos
     trechos usados.** O builder decide como checar (por exemplo, todo número da resposta tem de
     aparecer nos trechos).
   - A IA também devolve **quais trechos usou**. Se não citar nenhum, ou citar um que não foi
     enviado, a resposta é descartada.
   - Qualquer falha nessas checagens → "Não tenho essa informação. Quer falar com um atendente?" e
     log de aviso (sem o texto do cliente).

### 7. Checagem (avaliação)

- Lista fixa de **~30 perguntas** sobre a base fictícia, num arquivo versionado, cada uma com o
  resultado esperado:
  - **Respondível:** a seção que deve ser encontrada e um fato que a resposta deve conter.
  - **Da revenda, fora da base:** o bot tem de dizer que não sabe.
  - **Fora do assunto:** recusa fixa (preço da carne, política, conselho, receita…).
  - **Manipulação e emergência:** alguns casos de cada.
  - **Preço:** vai para o código, não para a IA.
- Dois níveis:
  - **Unitário e sem rede** (`pnpm test`): com embeddings fake determinísticos e IA fake, testa a
    lógica (corte de relevância, checagens de saída, roteamento por intenção, emergência, limite).
  - **Ao vivo** (por exemplo `pnpm rag:check`, no padrão do `pnpm llm:check`, com
    `vitest.config.live.ts`): ingere a base fictícia num banco de teste, roda as perguntas contra o
    provedor real e mostra o placar por grupo (acerto da busca, "não sei" correto, recusas corretas).
    Serve para calibrar k, o corte de relevância e os prompts. Não roda na CI.
- O builder registra no guia o placar atingido e os valores calibrados.

### 8. Documentação a atualizar

Guia novo (por exemplo `docs/guides/modules/knowledge.md`): como escrever a base, rodar a ingestão,
rodar a checagem e trocar de provedor ou modelo. Atualizar também:
- `docs/guides/integrations/llm.md` (embedding e provedor trocável);
- `docs/guides/conventions/environment.md`;
- `docs/security/SECURITY.md` (guard rails, injeção de prompt, limite de custo);
- `docs/project/funcionalidades.md` (F06/F13 saem das melhorias futuras, e a tabela "Onde cada
  funcionalidade usa IA" muda);
- `docs/project/fluxo.md`, `requisitos.md` e `CLAUDE.md` (pasta da base, comandos novos, segredos).

## Fases de entrega

1. **Fase 1:** pgvector + ingestão + busca híbrida + embedding na integração + base fictícia +
   checagem + classificação nova + respostas de dúvida + preço pelo código + produto inexistente +
   cliente travado.
2. **Fase 2:** emergência, recusa fixa, ofensa, limite por telefone e checagens de saída da IA, com os
   casos de manipulação e emergência entrando na checagem.

As fases podem virar dois PRs. A fase 2 não pode ficar para "nunca": a fase 1 só vai para `main`
junto com a fase 2.

## Fica com o builder

- Nomes de arquivos, módulos e tipos; local da pasta da base.
- Estratégia de chunk, k, índice vetorial, fórmula da busca híbrida e corte de relevância.
- Textos finais das mensagens fixas (em português, tom do `messages.ts`).
- Como checar números da resposta contra os trechos.
- Modelo de embedding inicial do Gemini e sua dimensão (conferir na documentação atual).
- Formato do arquivo de perguntas da checagem.

## Decisões minhas (para o usuário conferir)

- Busca híbrida (vetor + texto em português) em vez de só vetor.
- Banco de vetores no Postgres que já temos, com pgvector.
- Sem trecho relevante, a IA não é chamada para responder → "não sei" + atendente.
- Dúvida no meio do pedido: responde e repete a pergunta da etapa.
- Preço sempre pelo código; a IA nunca responde preço.
- Três mensagens sem entendimento → oferece atendente.
- Emergência (vazamento) com texto fixo, sem IA.
- Limite de chamadas de IA por telefone por hora.
- A IA cita os trechos que usou, e a resposta é descartada se não citar.
- Fase 1 só vai para `main` junto com a fase 2.
- "Oferecer o atendente" é um botão; transferência direta só quando o cliente pede ou na emergência.
- A base não tem valores em R$. Preço, taxa e frete, horário e formas de pagamento são respondidos pelo
  código.
- A resposta de preço mostra só o preço base, nunca o preço especial do cliente.
- Primeira mensagem que é só dúvida: o bot responde com o botão "Fazer pedido", sem iniciar o pedido.
