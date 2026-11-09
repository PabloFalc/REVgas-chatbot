# Design — Handoff para atendente via Chatwoot (F07)

Data: 2026-11-09 · Status: rascunho para aprovação

## Intenção

Hoje, quando o cliente pede atendente, o bot responde só com o telefone da revenda (`STORE_PHONE`).
O cliente precisa trocar de número e repetir tudo. O handoff tinha saído do MVP em 2026-10-21 porque
faltava definir **quem recebe** a conversa. A resposta agora é o **Chatwoot**: uma plataforma de
atendimento open source, com caixa de entrada para atendentes (web e app), API REST e webhooks.

Com a F07, o atendente da revenda assume a conversa **no mesmo WhatsApp**, pelo Chatwoot, já com um
resumo do que o bot coletou. O bot continua ajudando o cliente **até o atendente de fato começar a
falar**, porque o cliente na fila ainda pode ter dúvidas que o bot resolve.

O Chatwoot **não** elimina a burocracia da Meta: o número continua na WhatsApp Cloud API, que já é
nossa. O Chatwoot economiza a tela do atendente, não a integração com o WhatsApp.

## Decisões do usuário

- **Plataforma:** Chatwoot.
- **Arquitetura (opção B):** o webhook da Meta continua chegando no **nosso bot**. O Chatwoot é a mesa
  do atendente, ligado por um canal do tipo **API**. O bot não vira "Agent Bot" do Chatwoot e o
  número de WhatsApp não é conectado ao Chatwoot.
- **Todas as conversas aparecem no Chatwoot**, mas as importantes são as transferidas. As que o bot
  atende sozinho ficam em segundo plano. Só as transferidas entram na fila e avisam a equipe.
- **Fora do horário:** o bot avisa que a revenda está fechada, informa o horário e deixa o cliente
  **na fila**. Quando alguém estiver disponível, o atendente chama o cliente.
- **O bot não fica inativo na fila.** Ele continua respondendo (pedido, dúvidas, repetir pedido) até o
  **atendente mandar a primeira mensagem** pelo Chatwoot. Só então o bot se cala para aquele telefone.
- **Pedido fechado na fila:** se o cliente fecha o pedido com o bot enquanto espera, ele **sai da fila
  sozinho**.
- **Falha da RevGás ao criar a venda:** o bot oferece **"Tentar de novo"** e **"Falar com atendente"**.
- **Janela de 24 h fora do horário:** o bot pede ao cliente que mande uma mensagem quando a revenda
  abrir (veja a seção 4). Templates da Meta ficam para depois.
- **Subir o Chatwoot no Docker** faz parte deste trabalho.

## Objetivos

- O cliente pede atendente de qualquer ponto da conversa e entra na fila do Chatwoot com um resumo
  para o atendente.
- O bot segue atendendo enquanto o cliente espera, e para no instante em que um humano responde.
- O atendente conversa com o cliente pelo Chatwoot, e as mensagens vão e voltam pelo WhatsApp.
- Quando o atendente resolve a conversa, o bot volta a atender aquele telefone.
- A revenda consegue acompanhar no Chatwoot todas as conversas, inclusive as que o bot fechou sozinho.
- Há um ponto de entrada único de handoff que os **guard rails** (documento separado) vão usar para
  transferir a conversa por outros motivos.
- O Chatwoot sobe localmente com um comando, e há um guia de como configurá-lo.

## Não objetivos

- Conectar o número do WhatsApp direto no Chatwoot ou usar o Chatwoot "Agent Bot".
- Resumo da conversa feito por IA (pode vir depois).
- Painel ou métricas de handoff (F08).
- Anexos (imagem, áudio, documento) nos dois sentidos. Só texto.
- Templates da Meta para o atendente falar com o cliente fora da janela de 24 h.
- Novos gatilhos de handoff além dos dois abaixo (os guard rails trazem os outros).
- Hospedar o Chatwoot em produção. Aqui é o ambiente local em Docker.
- Integrações não oficiais de WhatsApp (QR code, Baileys, Evolution API).

## Anti-objetivos (falha mesmo se "funcionar")

- **Bot e atendente falando ao mesmo tempo** depois que o atendente começou a conversa.
- Bot calado enquanto o cliente ainda está só **na fila** (nenhum humano respondeu).
- **Dígitos de CPF chegando ao Chatwoot**, seja na nota de resumo, seja na cópia das mensagens.
- Mensagens do próprio bot copiadas no Chatwoot **voltando para o cliente** (eco/loop).
- O Chatwoot fora do ar **quebrar ou atrasar a resposta do bot** ao cliente.
- Cliente preso para sempre num handoff que ninguém resolveu, sem o bot voltar.
- Rota de webhook do Chatwoot aceitando chamadas sem autenticação.
- `pnpm test`, `pnpm test:e2e` ou a CI passarem a depender de um Chatwoot rodando.
- Etapas de `flow/steps/` importando Nest, Redis, integrações, serviços ou repositórios.

## Como funciona

### 1. Estados do handoff por telefone

O estado do handoff fica no **Redis, por telefone, separado do pedido**, com prazo próprio. Ele não
morre junto com os 15 min do pedido.

| Estado | Quem fala com o cliente | Como entra | Como sai |
| --- | --- | --- | --- |
| (nenhum) | Bot | — | Pedido de atendente → `queued`; mensagem humana no Chatwoot → `active` |
| `queued` | **Bot** (normal) | Gatilho de handoff | 1ª mensagem humana → `active`; venda criada pelo bot → nenhum; resolvido no Chatwoot → nenhum |
| `active` | **Atendente**; bot só repassa | 1ª mensagem humana no Chatwoot | Resolvido no Chatwoot → nenhum; 24 h sem mensagem do atendente → nenhum |

**Qualquer mensagem humana** numa conversa do telefone leva a `active`, mesmo que o cliente não esteja
na fila (por exemplo, um atendente que puxa uma conversa só do bot). Assim bot e atendente nunca
falam juntos.

O estado guarda também o id da conversa e do contato no Chatwoot, o motivo e quando entrou na fila.

**Pedido em andamento ao virar `active`:** o pedido do Redis é **apagado** (o resumo já foi para a
nota interna), e o lembrete é cancelado. Isso evita que o cliente toque "Confirmar" ou "Tentar de
novo" depois que o atendente já lançou a venda à mão. Exceção: se o pedido estiver em `creatingSale`,
espera a criação terminar antes de apagar. Quando o handoff acaba, o cliente começa do zero com o bot.

**Identidade não confirmada:** se o pedido de atendente vem antes da verificação de CPF (F14), por
exemplo em `askCpfPrefix` ou num telefone bloqueado, o handoff acontece normalmente, mas a nota
**não leva nome, endereço nem dados do pedido**. Ela diz só "identidade não confirmada" e o motivo.
O atendente confirma a identidade por conta própria.

### 2. Espelho de todas as conversas

- Toda mensagem do cliente e toda resposta do bot são copiadas para a conversa do telefone no
  Chatwoot (canal API): as do cliente como entrada, as do bot como saída.
- Botões e listas viram texto com o corpo e os títulos das opções.
- **Uma conversa do Chatwoot por ciclo**, não uma eterna por telefone. Enquanto só o bot atende, a
  conversa fica `pending` (fora da fila principal). Quando o pedido termina sem handoff (venda criada,
  cancelado ou expirado), o bot **resolve** a conversa. A próxima mensagem do cliente abre uma conversa
  nova, de novo como `pending`. O id da conversa atual fica numa chave própria do Redis por telefone,
  separada do estado do handoff. O builder confere na versão fixada se uma mensagem nova reabre a
  conversa resolvida como `open`. Se reabrir, o bot cria uma conversa nova ou volta o status para
  `pending`, para não avisar a equipe à toa.
- Ao entrar na fila, a conversa vira `open` sem atendente atribuído.
- **Identidade do bot no Chatwoot:** as mensagens do bot são postadas com o token de um **Agent Bot**
  do Chatwoot, usado só como identidade de remetente. A arquitetura continua sendo a B. Com isso o
  remetente é `AgentBot`, a conversa **não** é atribuída automaticamente a ninguém, e fica fácil
  distinguir bot de humano (eco e "primeira mensagem humana"). As mensagens do cliente entram como
  mensagens de entrada do contato no canal API. O builder confere na documentação da versão fixada.
  Se não funcionar, cai para um usuário dedicado, garantindo que a conversa não fique atribuída a ele.
- **O espelho nunca bloqueia nem derruba a resposta ao cliente.** Falhas do Chatwoot viram log de
  aviso e a conversa com o cliente segue. Pode ser assíncrono.
- **CPF:** nas etapas em que o cliente digita CPF (`askCpf`, `askCpfPrefix`), a mensagem vai para o
  Chatwoot como `[CPF ocultado]`. Isso vale também para mensagens que pareçam CPF em qualquer etapa
  (mesma regra de máscara do `src/utils/mask` / `src/utils/cpf`).

### 3. Gatilhos (nesta etapa)

1. **Pedido do cliente**, de qualquer ponto: as palavras de hoje em `global-commands.ts`
   (`atendente`, `falar com alguem`, `humano`). O estado do pedido não muda.
2. **Falha ao criar a venda**: a etapa `saleFailed` passa a ter dois botões, **"Tentar de novo"** e
   **"Falar com atendente"**.

Os dois chegam no mesmo ponto de entrada, uma ferramenta nova em `FlowTools`, por exemplo
`requestHandoff({ reason, state })`. Ela devolve um resultado simples: `queued`, `alreadyQueued`,
`active` ou `unavailable`, e diz se está dentro do horário. As etapas continuam puras e testáveis com
`createFakeTools`. **Os guard rails vão chamar esse mesmo ponto**, com outros `reason`.

### 4. Entrada na fila

- O bot cria ou reaproveita o contato (pelo telefone) e a conversa no Chatwoot, muda para `open` e
  deixa uma **nota interna** com o resumo, gerada pelo código, sem IA: motivo, etapa do pedido,
  produto, quantidade, endereço, forma de pagamento, total (se houver) e nome do cliente.
  **Nunca o CPF.**
- Resposta ao cliente:
  - **Dentro do horário:** "Já chamei um atendente. Enquanto isso, posso te ajudar com outras
    dúvidas." (texto final fica com o builder).
  - **Fora do horário:** avisa que a revenda está fechada, diz quando abre (o próximo horário de
    atendimento) e pede que o cliente **mande uma mensagem quando a revenda abrir** para um atendente
    responder. Por exemplo: "Abrimos segunda às 8h. Quando abrirmos, mande um 'oi' aqui que um
    atendente te responde." O cliente continua na fila.
    Motivo (decisão do usuário): a Meta só permite mensagem livre até 24 h depois da última mensagem
    do cliente. Numa fila de fim de semana, o atendente não conseguiria escrever primeiro, e a
    mensagem do cliente ao voltar reabre essa janela. Templates da Meta ficam para depois.
- **Já na fila** (`queued`) e pede de novo: "Você já está na fila, um atendente vai te chamar."
- **Chatwoot fora do ar ou não configurado:** volta ao comportamento de hoje, com o telefone da
  revenda (`msg.talkToStore`).

### 5. Enquanto está na fila (`queued`)

- O bot segue o fluxo normal. O lembrete de 10 min continua valendo para o pedido.
- **Se o bot cria a venda**, ele resolve a conversa no Chatwoot e deixa uma nota interna:
  "Venda #123 criada pelo bot, saiu da fila." O estado do handoff é apagado.
- "Cancelar" desiste do pedido, mas **não tira o cliente da fila**.

### 6. Atendente assume (`active`)

- O sinal é a **primeira mensagem de saída enviada por um usuário humano** no Chatwoot
  (`message_created`, saída, remetente humano). Só atribuir a conversa a alguém **não** basta.
- A partir daí, toda mensagem do cliente vai **só** para o Chatwoot, sem rodar o fluxo. O bot não
  responde nada, e o lembrete de pedido parado não dispara.
- Mensagens do atendente vão para o WhatsApp com o nome dele na frente: `*Maria (atendente):* ...`.
- Notas internas (privadas) do Chatwoot **não** vão para o cliente.
- **Eco:** as mensagens que o próprio bot copiou para o Chatwoot também disparam webhook. Elas são
  reconhecidas e ignoradas, e nunca voltam ao cliente.
- **Janela de 24 h da Meta:** se o envio da mensagem do atendente falhar porque passou da janela, o
  bot deixa uma nota interna avisando que o cliente precisa mandar mensagem primeiro.
- Mensagem não suportada do cliente (áudio, imagem…) durante `active`: vai para o Chatwoot como
  texto indicando o tipo, por exemplo `[cliente enviou áudio]`.

### 7. Fim do handoff

- Atendente **resolve** a conversa no Chatwoot (`conversation_status_changed` → `resolved`): o estado
  do handoff é apagado e a próxima mensagem do cliente volta ao bot.
- **Rede de segurança:** um handoff `active` sem nenhuma mensagem do atendente por **24 h** expira. O
  bot resolve a conversa no Chatwoot com uma nota ("handoff expirado, o bot voltou a atender") e
  volta a atender. Em `queued`, o prazo de segurança fica com o builder (sugestão: 72 h).

### 8. Horário de atendimento

Variável de ambiente do nosso lado, com fuso fixo da revenda (`America/Fortaleza`). O formato fica com
o builder, por exemplo `seg-sex 08:00-18:00; sab 08:00-12:00`. Sem a variável, considera sempre
dentro do horário.

### 9. Integração `integrations/chatwoot/`

Mesmo padrão das outras integrações (`docs/guides/integrations/*.md`):

- Cliente HTTP com respostas validadas por Zod, erros próprios em `core/erros/chatwoot/`,
  `CHATWOOT_MODE` `live`/`fake`, e um **fake** para testes unitários e e2e.
- Operações mínimas: criar ou buscar contato, criar ou buscar conversa, enviar mensagem (entrada,
  saída, nota privada), mudar status.
- **Webhook de entrada**: rota nova (por exemplo `POST /webhooks/chatwoot`), pública, com throttle,
  **autenticada**. O builder verifica se a versão do Chatwoot usada assina os webhooks e, se assinar,
  valida a assinatura. Se não assinar, usa um segredo na URL ou num header, comparado com
  `src/utils/safe-equal`. Validar o payload com Zod e documentar com `@ApiDoc`.
- Variáveis novas (URL, token de acesso, id da conta, id da caixa, segredo do webhook, horário) entram
  em `env.ts` e em `docs/guides/conventions/environment.md`. O **token** e o **segredo do webhook**
  entram na lista de segredos do `CLAUDE.md` e do `docs/security/SECURITY.md`: nunca em logs,
  respostas ou prompts.
- Telefone e endereço em logs com `src/utils/mask`.
- **Nunca reenviar POST** ao Chatwoot automaticamente (mesma regra da RevGás), para não duplicar
  mensagem.

### 10. Onde fica cada coisa (sugestão, o builder pode ajustar)

- `modules/handoff/`: serviço do handoff, repositório (estado no Redis) e gateway para o Chatwoot.
  Respeita as regras de dependência: o serviço não importa `integrations/` direto.
- `flow-tools.ts`: liga `requestHandoff` ao serviço.
- `ConversationService`: antes de rodar o fluxo, consulta o estado do handoff; em `active`, só
  repassa. Depois de responder, dispara o espelho.
- Controller do webhook do Chatwoot: onde o builder achar melhor. Se `RoutesModule` passar a
  importar outro módulo além de `ConversationModule`, atualizar o `CLAUDE.md`.

### 11. Chatwoot no Docker

- Serviços novos no `docker-compose.yml` atrás de um **profile** (por exemplo `chatwoot`), para
  `pnpm docker:init` e a CI continuarem leves: app Rails, Sidekiq, **Postgres próprio com pgvector** e
  **Redis próprio** (o nosso Redis usa `allkeys-lru`, que pode apagar filas do Sidekiq).
- Imagem do Chatwoot com **versão fixa** (a estável mais recente na data). Porta `3000` (o bot usa
  `3100`).
- Scripts `pnpm` para subir e preparar o banco do Chatwoot.
- Segredos do Chatwoot (`SECRET_KEY_BASE` etc.) por variáveis de ambiente, nunca commitados.
- Guia novo `docs/guides/integrations/chatwoot.md`: subir, criar a conta e o admin, criar a caixa do
  tipo API, gerar o token, configurar o webhook apontando para o bot
  (`http://host.docker.internal:3100/...`) e ligar `CHATWOOT_MODE=live`.

### 12. Documentação a atualizar

`docs/project/fluxo.md`, `requisitos.md` (RF11 volta ao escopo), `funcionalidades.md` (F07),
`docs/guides/conventions/environment.md`, `docs/security/SECURITY.md`, `CLAUDE.md` (integração nova,
segredos) e `README.md` se for preciso.

## Testes

- Etapas e comandos globais com `createFakeTools`: pedido de atendente em vários estados, já na fila,
  Chatwoot indisponível, dentro e fora do horário, os dois botões do `saleFailed`.
- Serviço de handoff com o fake do Chatwoot: entrada na fila, nota sem CPF, `queued` → `active` só com
  mensagem humana, eco ignorado, nota privada não vai ao cliente, venda criada tira da fila, resolvido
  volta ao bot, expiração de 24 h.
- E2e do webhook do Chatwoot: autenticação recusada, payload inválido, mensagem do atendente chega ao
  WhatsApp fake com o nome na frente.
- Espelho: falha do Chatwoot não impede a resposta ao cliente; CPF ocultado.

## Fica com o builder

- Nomes de arquivos, tipos e textos finais das mensagens (em português, tom do `messages.ts`).
- Como identificar o eco (id de origem, atributo da mensagem, tipo de remetente).
- Formato da variável de horário e prazo de segurança do `queued`.
- Detalhes da API e dos webhooks do Chatwoot: conferir na documentação oficial da versão fixada.
- Se o espelho é síncrono com tempo limite curto ou assíncrono.

## Decisões minhas (para o usuário conferir)

- Resumo do atendente gerado pelo código, sem IA.
- Chatwoot fora do ar → telefone da revenda (comportamento de hoje).
- Nome do atendente na frente da mensagem (`*Maria (atendente):*`).
- Horário de atendimento numa variável nossa, não na configuração da caixa do Chatwoot.
- "Cancelar" não tira da fila; pedir atendente de novo responde "você já está na fila".
- CPF digitado pelo cliente aparece como `[CPF ocultado]` no Chatwoot.
- `active` expira após 24 h sem mensagem do atendente.
- Chatwoot com Postgres e Redis próprios, atrás de um profile do Docker.
- Qualquer mensagem humana no Chatwoot leva a `active`, mesmo fora da fila.
- Ao virar `active`, o pedido em andamento é apagado. Depois do handoff, o cliente recomeça do zero.
- Handoff antes da verificação de CPF: acontece, mas a nota não traz nome, endereço nem pedido.
- Uma conversa do Chatwoot por ciclo, resolvida pelo bot quando o pedido termina sem handoff.
- Mensagens do bot no Chatwoot assinadas por um Agent Bot (só como identidade).
- Expiração de 24 h em `active` resolve a conversa no Chatwoot com nota.
