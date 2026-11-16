# Simulador de chat no terminal (`pnpm chat`)

Ferramenta de desenvolvimento para conversar com o bot **sem WhatsApp**: você digita como o
cliente, o bot responde no terminal e, se o Chatwoot local estiver configurado, a mesma conversa
aparece no painel do atendente (`http://localhost:3000`). Não muda o comportamento do bot: é o
mesmo `AppModule`, o mesmo fluxo e o mesmo espelho no Chatwoot.

## Passo a passo

1. **Infra do bot de pé** (Postgres com pgvector e Redis):
   ```bash
   pnpm docker:init
   pnpm db:migrate
   ```
2. **Chatwoot local** (opcional, só para ver a conversa no painel). Primeira vez: siga
   [chatwoot.md](../integrations/chatwoot.md#subir-o-chatwoot-local-docker). Depois:
   ```bash
   pnpm chatwoot:up
   ```
   Em `http://localhost:3000`, a configuração esperada é:
   - conta **1** e caixa do tipo **API** com id **1**
     (`/app/accounts/1/inbox/1`);
   - URL do webhook da caixa: `http://host.docker.internal:3100/webhooks/chatwoot`;
   - atribuição automática desligada e o Agent Bot criado, mas **não** conectado à caixa.
3. **`.env` do bot** com as variáveis do Chatwoot
   ([environment.md](./environment.md#chatwoot-handoff-para-atendente)):
   ```env
   CHATWOOT_MODE=live
   CHATWOOT_URL=http://localhost:3000
   CHATWOOT_ACCOUNT_ID=1
   CHATWOOT_INBOX_ID=1
   CHATWOOT_API_TOKEN=...
   CHATWOOT_BOT_TOKEN=...
   CHATWOOT_WEBHOOK_SECRET=...
   ```
   IA/RAG (`LLM_*`, `EMBEDDING_*`, `KNOWLEDGE_*`), ViaCEP, `SERVICE_HOURS`, `STORE_*` também vêm
   do `.env`, como no `pnpm start:dev`.
4. **Pare o `pnpm start:dev`** se estiver rodando: o simulador sobe o app na mesma porta (`PORT`,
   padrão `3100`) para o webhook do Chatwoot continuar chegando.
5. Rode:
   ```bash
   pnpm chat
   ```
   O comando faz `nest build` e sobe o app. Use `pnpm chat --help` para ver as opções.

## Opções

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `--phone <número>` | `5586999990000` | Telefone do cliente simulado, só dígitos com DDI (formato `wa_id`). |
| `--name <nome>` | `Cliente Simulador` | Nome do perfil do WhatsApp (vai para o contato no Chatwoot). |
| `--revgas <modo>` | `fake` | `fake` (nenhuma chamada ao ERP) ou `hybrid` (leituras reais, escrita simulada; exige `REVGAS_API_KEY` e `REVGAS_ESTABLISHMENT_ID` no `.env`). `live` é recusado para não criar venda real. |
| `--log-file <arq>` | `logs/chat.log` | Arquivo dos logs do app. |

Exemplo: `pnpm chat --phone 5586988887777 --name "Maria Souza" --revgas hybrid`.

## Como usar

- **Texto livre** vai como mensagem de texto.
- **Botões e listas** aparecem numerados (`[1] Confirmar  [2] Corrigir`; listas mostram as seções).
  Digitar o número equivale a tocar no botão ou escolher o item: o bot recebe a resposta
  interativa (`button_reply`/`list_reply`) com o id e o título certos, e o terminal mostra
  `você → Confirmar`.
- Os números valem só para a **última** mensagem do bot. Se depois dela chegou uma mensagem de
  texto, ou se o número está fora do menu, ele vai como texto (CEP, quantidade...).
- **Mensagens fora do turno** (atendente respondendo pelo Chatwoot, lembrete de pedido parado
  depois de 10 min) aparecem no terminal assim que o bot as envia.

| Comando | O que faz |
| --- | --- |
| `/texto <msg>` | Manda `<msg>` como texto, mesmo que seja um número do menu. |
| `/novo` | Apaga o pedido e o lembrete deste telefone; a próxima mensagem começa do zero. |
| `/ajuda` | Mostra os comandos. |
| `/sair` ou Ctrl+C | Encerra o simulador e fecha o app. |

### `/novo` e o handoff

`/novo` apaga **só** o pedido (`conversation:order:<tel>`) e o lembrete. **Não** mexe no estado
do handoff (`handoff:state`, `handoff:thread`, `handoff:contact`): esse estado está casado com a
conversa no Chatwoot, e apagá-lo por fora deixaria a conversa aberta no painel enquanto o bot
abriria outra na próxima mensagem. Para tirar o cliente da fila ou do atendente, **resolva a
conversa no Chatwoot** (o webhook encerra o handoff). Também não apaga identidade confirmada,
tentativas de CPF nem bloqueio. Para começar com um cliente "novo em tudo", use outro `--phone`.

## Logs

Os logs do app **não** saem no terminal: vão para `logs/chat.log` (pasta `logs` no `.gitignore`;
troque com `--log-file`). Para acompanhar, em outro terminal: `tail -f logs/chat.log`. O nível
continua o de `LOG_LEVEL` (padrão `debug` em dev). O mecanismo é a variável `LOG_FILE`
([environment.md](./environment.md)), que o simulador liga sozinho.

## O que o simulador força

Antes de carregar o `.env`, o simulador define estas variáveis (o `dotenv` não sobrescreve o que já
existe, então elas ganham do `.env`):

| Variável | Valor | Por quê |
| --- | --- | --- |
| `WHATSAPP_MODE` | `fake` | Nada vai para a Meta. As respostas são lidas do `FakeWhatsappClient` (`WHATSAPP_CLIENT`). |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | vazio | O processo nem carrega os tokens da Meta. |
| `WHATSAPP_PHONE_NUMBER_ID` | `100000000000000` | Número da caixa usado nas mensagens simuladas (o webhook filtra por ele). |
| `REVGAS_MODE` | `--revgas` (padrão `fake`) | Não criar venda real no ERP. |
| `LOG_FILE` | `--log-file` | Logs fora do terminal. |

Recusa rodar com `NODE_ENV=production` (vindo do shell ou do `.env`).

## Decisões

- **Injeção direta, sem POST.** A mensagem digitada vira um payload de webhook da Meta
  (`inboundPayload`), passa pelo mesmo parser do controller (`WhatsappWebhook.parse`) e vai para
  `ConversationService.handle`, aguardado. Um POST assinado em `/webhooks/whatsapp` exigiria o
  `WHATSAPP_APP_SECRET` (segredo que o simulador não deve tocar) e, como a rota responde antes de
  processar, não daria para saber quando o turno terminou. O que fica de fora é só o que o
  controller faz antes: assinatura e throttle.
- **Saída por polling.** A cada 250 ms o simulador lê o que entrou na caixa de saída do
  `FakeWhatsappClient` para o telefone do cliente. É assim que as mensagens fora do turno
  aparecem sem precisar mexer no bot.
- **Ids únicos.** Cada mensagem tem id `wamid.chat.<uuid>`, então a deduplicação do bot (24 h) não
  descarta mensagens entre execuções.

## Limitações

- Não simula áudio, imagem nem outros tipos: só texto e respostas de botão/lista.
- Marcar como lida não tem efeito visível.
- O simulador grava no Redis do bot como um cliente real (pedido, contato do handoff, uso de IA,
  dedup). Use um telefone de teste.

## Arquivos

```
src/cli/chat.ts               entrada: lê as opções, força as variáveis, recusa produção
src/cli/chat/chat.args.ts     opções e variáveis forçadas
src/cli/chat/chat.render.ts   mensagem do bot → linhas do terminal + menu numerado
src/cli/chat/chat.input.ts    linha digitada → texto, escolha ou comando; payload do webhook
src/cli/chat/chat.session.ts  sessão: caixa de saída, menu atual e comandos
src/cli/chat/chat.runtime.ts  sobe o app (createServer), REPL e encerramento
```

As partes puras têm testes unitários ao lado (`*.spec.ts`); a sessão é testada com o
`FakeWhatsappClient` de verdade.
