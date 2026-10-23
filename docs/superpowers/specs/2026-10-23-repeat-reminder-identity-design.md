# Design — Repetir último pedido (F04), lembrete de pedido parado (F12) e verificação de identidade (F14)

Data: 2026-10-23 · Status: rascunho para aprovação

## Intenção

Três melhorias no fluxo do WhatsApp, todas sobre o cliente que **já existe**:

- **F14 — Verificação de identidade.** O número de celular pode ter mudado de dono. Hoje o bot
  reconhece o telefone e já mostra o nome e os endereços do dono anterior. Com a F14, o cliente
  cadastrado confirma os 3 primeiros dígitos do CPF antes de ver qualquer dado dele.
- **F04 — Repetir último pedido.** O cliente fiel pede sempre a mesma coisa. Hoje ele passa por
  endereço, produto, quantidade e pagamento toda vez. Com a F04, ele vê o último pedido e fecha em
  2 toques (Repetir → Confirmar).
- **F12 — Lembrete de pedido parado.** O cliente para de responder no meio e o pedido some aos
  15 min sem aviso. Com a F12, aos 10 min parado ele recebe um lembrete com a pergunta da etapa.

Tudo vem da API RevGás (cadastro e vendas) e do Redis. **Não usa o Postgres** (RN13 segue fora do
escopo).

Ordem de entrada do cliente cadastrado: **F14 (verificação) → boas-vindas com nome → F04 (oferta) →
fluxo normal**.

## Decisões do usuário

- **F12:** um único lembrete aos **10 min** sem resposta; o pedido continua expirando aos 15 min,
  **sem** aviso de cancelamento. O lembrete **reenvia a pergunta da etapa com os botões**.
- **F04:** a mensagem mostra o último pedido inteiro (produto, quantidade, pagamento, endereço) com os
  botões **Repetir** e **Novo pedido**. **Repetir copia tudo e vai para o resumo**; a venda só sai no
  botão "Confirmar", como hoje.
- **F14:** o risco tratado é o **número que mudou de dono**. O cliente cadastrado confirma os **3
  primeiros dígitos do CPF**. A verificação vale **15 dias** por telefone.
- **F14, dígitos errados:** depois de 3 tentativas, mensagem fixa pedindo para falar com a revenda e
  fim da conversa. Não cadastra como cliente novo.
- **F14, cliente cadastrado sem CPF:** mesma coisa — mensagem fixa pedindo para falar com a revenda.
  **Isso substitui o comportamento atual** (`askMissingCpf`, que pedia e gravava o CPF): o bot não
  grava mais CPF em cadastro existente, porque o novo dono do número gravaria o CPF dele no cadastro
  do dono anterior.
- "Falar com a revenda" = o telefone `STORE_PHONE`, via `storeContact` (já usado em `msg`).

## Objetivos

- Cliente cadastrado com CPF só vê nome, endereços e último pedido depois de acertar os 3 dígitos
  (ou se o telefone foi verificado nos últimos 15 dias).
- Cliente que repete o pedido fecha em 2 toques, com o **preço de hoje** calculado no backend.
- Cliente parado há 10 min recebe exatamente um lembrete por período parado.

## Não objetivos

- Aviso de pedido expirado aos 15 min.
- Lembrete fora da janela de 24 h do WhatsApp (template aprovado) — os 10 min ficam bem dentro dela.
- Repetir pedido com mais de um produto (o fluxo só monta pedido de um produto).
- Cadastrar como novo cliente quem errou os dígitos ou atualizar CPF de cadastro existente.
- Guardar vendas ou histórico no Postgres.

## Anti-objetivos (falha mesmo se "funcionar")

- Mostrar **nome, endereço ou último pedido** antes da verificação.
- O CPF (inteiro ou os dígitos digitados) aparecer em log, em resposta do bot ou no prompt da IA.
- "Repetir" criar a venda sem passar pelo resumo e pelo botão "Confirmar", ou usar o preço da venda
  antiga.
- Lembrete duplicado, lembrete depois que o cliente já respondeu, ou lembrete que **renova** os
  15 min do pedido.
- Lembrete enviado enquanto a venda está sendo criada (`creatingSale`).
- O agendador do lembrete importar Redis/WhatsApp dentro de `flow/` (as etapas continuam puras,
  testáveis com `createFakeTools` — RNF08).

## Como funciona

### 1. F14 — Verificação de identidade

**Quando pergunta.** Em `start()` (`flow/steps/customer.step.ts`), o cliente encontrado por
`findCustomer`:

| Situação | O que o bot faz |
| --- | --- |
| Cadastrado **sem CPF** | Mensagem fixa `identityContactStore(phone)` e `state: null`. Sem nome na mensagem. |
| Cadastrado com CPF, telefone **bloqueado** (errou 3× na última hora) | Mesma mensagem fixa, `state: null`. |
| Cadastrado com CPF, telefone **verificado nos últimos 15 dias** | Segue como hoje: boas-vindas com nome → F04/fluxo. |
| Cadastrado com CPF, **não verificado** | Etapa nova `askCpfPrefix`: *"Olá! Para sua segurança, digite os 3 primeiros dígitos do seu CPF."* Sem nome. |
| Não cadastrado | Igual a hoje (`askName` → `askCpf` → cadastro). |

Antes da verificação o bot **não chama** `customerHistory` (não há por que buscar endereços que ainda
não podem ser mostrados).

**Etapa `askCpfPrefix`.**

- Entrada com exatamente 3 dígitos (depois de tirar o que não é dígito) igual aos 3 primeiros do CPF
  do cadastro → marca o telefone como verificado por 15 dias, manda as boas-vindas com nome e segue
  para F04/fluxo (o mesmo caminho que hoje vem depois do CPF).
- 3 dígitos diferentes → conta uma tentativa. Tentativas 1 e 2: *"Não confere. Digite os 3 primeiros
  dígitos do seu CPF."* Na 3ª: bloqueia o telefone por **1 hora**, mensagem fixa
  `identityContactStore`, `state: null`.
- Qualquer outra coisa (texto, CPF inteiro, botão) **não conta tentativa**: repete a pergunta. Texto
  com cara de pedido segue a regra atual das etapas de identificação (`freeText` anota os campos e
  repete a pergunta — ver `IDENTIFICATION_STEPS` em `flow/free-text.ts`, que passa a incluir
  `askCpfPrefix`).
- Comandos globais (cancelar, atendente, desconto) continuam valendo.

**Onde guarda.**

- Tentativas: contador no Redis por telefone, com TTL de 1 hora, **fora** do `OrderState` — assim
  "cancelar" ou o pedido expirar não zera as tentativas. O CPF do cadastro fica no estado como hoje
  (`customer.cpf`), só no Redis.
- "Verificado por 15 dias" e "bloqueado por 1 hora": chaves no Redis por telefone, acessadas pelo
  `ConversationRepository` (ou um repositório novo no módulo `conversation`) e expostas ao fluxo por
  `FlowTools` novas, ex. `isVerified(phone)`, `markVerified(phone)`, `isBlocked(phone)`,
  `block(phone)`. `flow-tools.ts` liga essas tools; `createFakeTools` ganha versões falsas.

**O que sai de cena.** A etapa `askMissingCpf` e o caminho `saveCpf` deixam de ser usados pelo fluxo
(cliente sem CPF agora recebe a mensagem fixa). Remover a etapa, a mensagem `askMissingCpf`, a tool
`saveCpf` e o `cpfTaken` **se** nada mais usar — o construtor confere. `CustomerRepository.saveCpf`
pode ficar se ainda tiver teste/uso; senão sai também.

**Logs.** Logar só o resultado (`verified`, `mismatch`, `blocked`) com o telefone mascarado
(`maskPhone`). Nunca os dígitos.

### 2. F04 — Repetir último pedido

**De onde vem.** `customerHistory` já lista as últimas 20 vendas do cliente (`sales.list` com
`customer_id`). Ela passa a devolver também o **último pedido repetível**:

- a venda mais recente (ordenar por `created_at ?? date`, mais nova primeiro — não confiar na ordem
  da API) com `status` diferente de `CANCEL`;
- com **exatamente 1 produto** e **1 pagamento**;
- com endereço completo (o mesmo `toAddress` já usado no histórico).

Se a venda mais recente não cancelada não servir (2 produtos, sem endereço...), **não oferece** —
não procura uma mais antiga. Formato sugerido em `customer/contracts`: `lastOrder?: { productId,
quantity, paymentType, address }`.

**Quando oferece.** Depois da verificação (F14) e das boas-vindas, se:

- existe `lastOrder`;
- o produto está em `listProducts` do cliente hoje (ativo, à venda para ele);
- o `paymentType` está em `listPaymentOptions`;
- `quote(...)` devolve preço para produto + pagamento + quantidade;
- a primeira mensagem **não** trouxe pedido em texto livre (seed vazio). Se trouxe, segue o que o
  cliente pediu.

Se qualquer condição falhar, segue o fluxo normal sem avisar.

**Etapa nova `offerRepeat`.** Botões, ex.:

> Quer repetir seu último pedido?
> 1× Botijão P13 · Pix
> Rua das Flores, 120 – Centro
>
> [Repetir] [Novo pedido]

- **Repetir** → preenche `address`, `product`, `quantity`, `payment` e `quote` (do cálculo acima,
  preço de hoje) e chama `nextStep`. Pagamento em **dinheiro** passa por `askNeedsChange` antes do
  resumo (o `nextStep` já faz isso); os outros vão direto para `summary`.
- **Novo pedido** → `nextStep` sem nada preenchido (fluxo de hoje).
- Texto digitado → `freeText`, como nas outras etapas. O que a IA anotar entra no pedido e o bot
  segue pedindo o que falta.

O resumo, o "Corrigir" e a criação da venda não mudam.

### 3. F12 — Lembrete de pedido parado

**Regra.** Um pedido guardado no Redis que ficou **10 min sem mensagem do cliente** recebe **um**
lembrete. Uma nova mensagem do cliente zera a contagem; se ele parar de novo, ganha outro lembrete
10 min depois. Não há lembrete na etapa `creatingSale`. Nas outras (inclusive `askCpfPrefix` e
`saleFailed`), há.

**Texto.** `msg.reminder`: *"Ainda está aí? Seu pedido fica guardado por mais 5 minutos."* — seguido
da pergunta da etapa atual com os botões, usando o `repeatQuestion` que já existe
(`flow/repeat-question.ts`). Sem IA.

**O lembrete não renova o prazo.** Salvar o estado depois do lembrete **não pode** reiniciar os
15 min (hoje `saveOrder` usa `setex` com 900 s). Usar `KEEPTTL` ou o TTL restante. Só mensagem do
cliente renova o prazo.

**Agendamento (sem dependência nova).** Proposta, o construtor pode ajustar mantendo as regras:

- O `ConversationRepository` mantém um sorted set no Redis (ex. `conversation:idle`), membro =
  telefone, score = horário em que vence o lembrete (última mensagem + 10 min). `saveOrder` depois de
  uma mensagem do cliente atualiza o score; `clearOrder` remove.
- Um provider no módulo `conversation` (ex. `ReminderScheduler`, com `OnModuleInit`/`OnModuleDestroy`)
  roda a cada ~30 s, pega os telefones vencidos e, para cada um:
  1. reivindica o item de forma atômica (ex. `ZREM` que retorna 1), para duas instâncias não mandarem
     o mesmo lembrete;
  2. tenta o lock do telefone **sem esperar** (se estiver ocupado, o cliente está mandando mensagem
     agora — pula);
  3. relê o estado; envia só se ele existe, não está em `creatingSale` e o cliente não respondeu
     depois do horário agendado (guardar ex. `lastInboundAt` no estado e conferir);
  4. envia pelo `MessagingGateway`, salva o estado mantendo o TTL.
- Desligado em `NODE_ENV=test` (ou com intervalo controlável) para não interferir nos e2e.

A lógica de "o que mandar" fica em `flow/` (função pura, ex. `reminder(state, tools)` → replies),
testável com `createFakeTools`. Só o agendador conhece Redis e WhatsApp.

**Logs.** `Lembrete enviado` / `Lembrete ignorado (motivo)` com telefone mascarado e a etapa.

## Textos novos (em `flow/messages.ts`, sem emoji)

| Chave sugerida | Texto |
| --- | --- |
| `askCpfPrefix` | "Olá! Para sua segurança, digite os 3 primeiros dígitos do seu CPF." |
| `cpfPrefixMismatch` | "Não confere. Digite os 3 primeiros dígitos do seu CPF." |
| `identityContactStore(phone)` | "Não consegui confirmar seus dados por aqui. " + `storeContact(phone)` |
| `offerRepeat(...)` | "Quer repetir seu último pedido?\n1× Botijão P13 · Pix\nRua das Flores, 120 – Centro" |
| `repeatOrder` / `newOrder` | "Repetir" / "Novo pedido" |
| `reminder` | "Ainda está aí? Seu pedido fica guardado por mais 5 minutos." |

## Testes

- **Etapas (Vitest + `createFakeTools`):** `askCpfPrefix` (acerto, erro 1/2/3, entrada inválida não
  conta, texto livre, bloqueado, verificado nos 15 dias, sem CPF → mensagem fixa); nome não aparece
  antes da verificação; `offerRepeat` (Repetir → resumo com preço do `quote`, dinheiro → troco, Novo
  pedido, texto livre, cada condição que impede a oferta, seed de texto livre pula a oferta);
  `reminder` (texto + pergunta da etapa, nada em `creatingSale`).
- **`CustomerRepository.history`:** escolhe a venda mais recente não cancelada, ignora as de 2
  produtos ou sem endereço.
- **Repositório/agendador:** score atualizado a cada mensagem, removido no `clearOrder`, lembrete não
  renova o TTL, reivindicação atômica, lock ocupado pula, cliente que respondeu não recebe.
- Atualizar os testes que hoje cobrem `askMissingCpf` / `welcomeBack` direto.

## Documentação a atualizar

- `docs/project/funcionalidades.md`: F04 e F12 entregues; F14 sai de "melhorias futuras" e vira
  entregue; nova decisão de escopo (2026-10-23).
- `docs/project/requisitos.md`: RF03 (cliente cadastrado sem CPF → falar com a revenda); decisão de
  2026-10-23 (verificação 15 dias, 3 tentativas, bloqueio 1 h); remover o "risco conhecido" da F14.
- `docs/project/fluxo.md`: etapas `askCpfPrefix` e `offerRepeat`, lembrete, saída de `askMissingCpf`.
- `docs/security/SECURITY.md`: verificação por prefixo de CPF, bloqueio contra chute.
- `CLAUDE.md`: menção ao agendador do lembrete no módulo `conversation`.

## Fica a critério do construtor

- Nomes de etapas, campos, tools e chaves do Redis.
- Mecanismo exato do agendador, desde que cumpra as regras da seção 3 (um lembrete por período
  parado, atômico entre instâncias, não renova TTL, não cruza com mensagem chegando).
- Como `customerHistory` devolve o último pedido (no mesmo retorno ou em tool separada).

## Decisões minhas (para revisar)

- Bloqueio de **1 hora** depois de 3 erros (sem isso, 1.000 combinações dão para chutar).
- Entrada que não é 3 dígitos não conta tentativa.
- Dinheiro no "Repetir" passa pela pergunta do troco antes do resumo.
- Só a venda mais recente não cancelada conta como "último pedido"; se não servir, não oferece.
- Texto livre com pedido (na primeira mensagem ou durante `askCpfPrefix`) pula a oferta de repetir:
  a oferta só aparece se o estado ainda não tem nenhum campo de pedido.
- "Verificado por 15 dias" fica ligado a **telefone + id do cliente na RevGás**, não só ao
  telefone. Se o telefone passar a bater com outro cadastro, a verificação antiga não vale para ele.
- O agendador usa um lock novo que **não espera** (o `withPhoneLock` atual espera e depois segue
  sem lock) e monta as `FlowTools` reais via `FlowToolsService.forPhone`, porque algumas perguntas
  chamam tools.
- Estado antigo em `askMissingCpf` que ainda esteja no Redis na hora do deploy cai em `start()`
  (sem handler), o que é seguro.
- Lembrete também em `saleFailed` e `askCpfPrefix`; nunca em `creatingSale`.
