# Fluxo de criação de venda — RevGás AI Flow

> Extraído de [revgas-ai-flow.md](revgas-ai-flow.md). Descreve a conversa e a máquina de estados.

O fluxo tem 8 passos e só chama "criar venda" no passo 7, depois do "confirmo" do cliente. Não há atendente humano (decisão de 2026-10-21): falha da API vira "Tentar de novo" e pedido de atendente recebe o telefone da revenda.

## Diagrama

```mermaid
flowchart TD
    A["1. Cliente manda mensagem<br/>Webhook do WhatsApp chega no backend"] --> B["2. Identificar cliente<br/>API: buscar cliente pelo telefone"]
    B --> C{Cliente existe?}
    C -- não --> D["Cadastrar cliente<br/>Coleta nome, CPF, endereço → API"]
    C -- sim --> V["Verificar identidade<br/>3 primeiros dígitos do CPF"]
    V --> E["3. Produto e quantidade<br/>API: produtos com preço e estoque"]
    D --> E
    E --> F["4. Confirmar endereço<br/>Sim ou alterar"]
    F --> G["5. Forma de pagamento<br/>Pix, cartão ou dinheiro com troco"]
    G --> H["6. Resumo e confirmação<br/>Itens, endereço e total vindo da API"]
    H --> I{Cliente confirmou?}
    I -- "não, corrige" --> E
    I -- sim --> J["7. Criar venda<br/>API: criar venda"]
    J --> K{API respondeu 2xx?}
    K -- não --> L["Avisar falha<br/>Botão Tentar de novo (volta ao 7)"]
    K -- sim --> M["8. Avisar o cliente<br/>Nº da venda, entregador e tempo estimado"]
    style J stroke-width:3px
```

## Passo a passo

O estado do pedido (`OrderState.step`) vive no Redis por 15 min. Os valores de `Step` e o que cada um faz:

| Step | O que faz | Entrada esperada |
| --- | --- | --- |
| `askName` | Cliente novo: pede o nome | Texto |
| `askCpf` | Cliente novo: pede o CPF e cadastra | Texto (CPF inválido ou já usado → pede de novo) |
| `askCpfPrefix` | Cliente existente: pede os 3 primeiros dígitos do CPF (ver [Verificação de identidade](#verificação-de-identidade)) | Texto (3 dígitos) |
| `offerRepeat` | Cliente verificado: oferece repetir o último pedido (ver [Repetir último pedido](#repetir-último-pedido)) | Botão (`repeat:yes\|new`) |
| `chooseAddress` | Mostra os endereços salvos (≤ 2 em botões, mais em lista) | Botão / lista (`address:<i>`, `address:new`) |
| `askNewAddress` | Pede CEP ou endereço completo (ViaCEP ou IA) | Texto |
| `askAddressField` | Pede o campo que faltou no endereço | Texto |
| `confirmAddress` | Confirma o endereço montado | Botão (`address:ok`, `address:retype`) |
| `pickProduct` | Texto livre citou um produto ambíguo: lista só os candidatos | Lista (`product:<id>`) |
| `chooseProduct` | Lista produtos (≤ 10 em lista; acima disso 9 + busca) | Lista (`product:<id>`, `product:search`) |
| `searchProduct` | Busca produto por texto | Texto |
| `chooseQuantity` | Quantidade em botões (1, 2, outra) | Botão (`qty:*`) |
| `askQuantity` | Quantidade digitada | Texto numérico |
| `choosePayment` | Formas de pagamento (≤ 3 em botões) | Botão / lista (`pay:<TYPE>`) |
| `askNeedsChange` | Dinheiro: precisa de troco? | Botão (`change:no\|yes`) |
| `askChangeAmount` | Dinheiro: troco para quanto (≥ total) | Texto numérico |
| `summary` | Itens, endereço, pagamento e total vindo da API | Botão (`summary:confirm\|fix`) |
| `chooseCorrection` | O que corrigir | Botão (`fix:product\|address\|payment`) |
| `creatingSale` | Cria a venda (único POST, sem retry automático) | — |
| `saleFailed` | Falha ao criar: avisa e oferece "Tentar de novo" | Botão (`retry:sale`) |

Ao concluir, o estado é apagado e o bot envia o número da venda.

### Regra do `nextStep`

Depois de qualquer etapa, `nextStep` vai para **o que falta no pedido**, nesta ordem: endereço,
produto, quantidade, pagamento. No endereço, a ordem é: rascunho em andamento (`askAddressField`),
texto de endereço pendente (`askNewAddress`, que o transforma em rascunho) e, por fim,
`chooseAddress` se há salvos ou `askNewAddress`. No produto, se há candidatos do texto livre vai
para `pickProduct`; senão, `chooseProduct`. Com tudo
preenchido, calcula a cotação (sem preço para o pagamento → volta a `choosePayment`) e vai para
`askNeedsChange` (dinheiro sem troco definido) ou `summary`. Por isso "Corrigir" limpa só o campo
escolhido e o fluxo retoma dali.

### Comandos globais

Valem em qualquer etapa (`global-commands.ts`): `cancelar` apaga o estado (bloqueado em
`creatingSale`); `atendente`/`humano` responde com o telefone da revenda (`STORE_PHONE`);
`desconto`/`promoção` responde que o preço é o da tabela e repete a pergunta; mensagem que não é
texto/botão/lista (áudio, imagem) pede texto e repete a pergunta. O estado não muda, exceto no cancelar.

## Verificação de identidade

Cliente que o telefone já identifica na RevGás precisa confirmar os 3 primeiros dígitos do CPF
antes de ver endereços ou pedidos (`askCpfPrefix`, em `flow/steps/customer.step.ts`). O telefone
pode ter mudado de dono.

- **Validade:** 15 dias, guardada no Redis por telefone + id do cliente na RevGás. Dentro do prazo o `start` pula a pergunta.
- **Sem CPF no cadastro, ou telefone bloqueado:** mensagem fixa com o telefone da revenda e a conversa termina (estado apagado). O bot não pede nem grava CPF de cadastro existente.
- **Erros:** 3 dígitos que não batem contam como tentativa; na 3ª o telefone fica bloqueado por 1 h e recebe o telefone da revenda. Acertar zera as tentativas.
- **Formato:** só conta como tentativa a entrada só numérica (dígitos, espaços, pontos ou traços, como `123`, `1 2 3` ou `123.`) com exatamente 3 dígitos. Texto com letras ("2 P13", "quero 1 botijão P13") nunca conta: segue para o texto livre abaixo. Sem pedido no texto, o bot pede de novo só os 3 dígitos.
- **Texto livre:** blocos soltos de 3 dígitos são removidos antes de o texto ir à IA, para o CPF nunca chegar ao prompt. Se não sobra texto, repete a pergunta.
- **Cliente novo:** quem acabou de se cadastrar (digitou o CPF inteiro) já fica verificado por 15 dias; o próximo pedido não pede os 3 dígitos.

## Repetir último pedido

Depois de verificado (`welcomeKnown`), se o cliente ainda não informou nada do pedido, o bot
oferece repetir o último (`offerRepeat`, em `flow/steps/repeat.step.ts`) com os botões "Repetir" e "Novo pedido".

- **Origem:** a venda não cancelada mais recente do cliente, só se tiver 1 produto, 1 pagamento e endereço completo.
- **Condições:** produto na lista do cliente, forma de pagamento ainda disponível e preço calculado por `tools.quote`. Se algo falhar (inclusive erro numa dessas consultas), segue o fluxo normal sem aviso.
- **Não oferece** se o texto livre inicial já trouxe produto, quantidade, pagamento ou endereço.
- **Repetir** preenche endereço, produto, quantidade, pagamento e preço atual e vai para `nextStep`: o resumo, ou a pergunta de troco se o pagamento for dinheiro. Nunca cria a venda sem o "Confirmar".
- **Novo pedido** segue o fluxo normal.
- **Digitado:** "sim" ou "repetir" valem como o botão "Repetir"; "novo", "novo pedido" ou "não" valem como "Novo pedido" (sem diferenciar maiúsculas nem acentos). Outro texto livre na oferta passa pela IA como em qualquer etapa.

## Lembrete de pedido parado

Se o cliente some no meio do pedido, o bot manda um lembrete aos 10 min sem mensagem dele
(`flow/reminder.ts`, enviado pelo `ReminderScheduler`).

- Uma vez por período parado; nova mensagem do cliente abre um novo período.
- Nunca durante `creatingSale`.
- Repete a pergunta da etapa atual com o aviso de que o pedido fica guardado por mais 5 minutos.
- Não renova o TTL de 15 min do pedido: só mensagem do cliente renova.
- O agendador varre a cada 30 s e fica desligado com `NODE_ENV=test`.

## Texto livre e fallback

A IA (`interpret`) só é chamada quando a etapa não entendeu a mensagem. Botões, listas e
palavras-chave funcionam sem IA, e os comandos globais vêm antes de tudo. Código em
`flow/free-text.ts`; o serviço de IA fica em `src/modules/assistant/`.

| Situação | Comportamento |
| --- | --- |
| Botão, lista ou palavra-chave que a etapa entende | Igual antes. Sem IA |
| Comandos globais (cancelar, atendente, desconto) | Antes de tudo. Sem IA |
| Etapa de botão recebe texto que não entende | IA |
| `askName` | Texto com dígito ou palavra de pedido → IA; senão, validação de nome de sempre |
| `askCpf`, `askCpfPrefix`, `askQuantity`, `askChangeAmount` | Primeiro a validação de sempre; se falhar e o texto não for só números e pontuação, mas tiver palavra de pedido → IA; senão, o erro de sempre |
| Primeira mensagem (sem estado) | Com dígito ou palavra de pedido → IA antes do `start`; senão ("oi") → `start` sem IA |
| `askNewAddress`, `askAddressField`, `searchProduct` | Sem mudança (já recebem texto livre) |
| `creatingSale`, `saleFailed` | Nunca chama a IA |

O que a IA devolve e como vira pedido:

- Saída validada com Zod: `intent` (`order`, `question` ou `other`), `products`, `quantity`, `payment`, `address`, `newAddress` e `confidence`.
- Confiança abaixo de 0,6 ou falha da IA (`null`) → "Não entendi." e repete a pergunta. O estado não muda.
- Produto e pagamento só entram se existirem em `listProducts` / `listPaymentOptions`. Preço, total e troco nunca vêm da IA.
- Vários produtos que batem → `pickProduct` com a lista filtrada; quantidade e pagamento ditos são mantidos.
- O que o cliente disser **substitui** o que já estava no pedido. O bot responde "Anotado: ..." com o que mudou e `nextStep` pergunta só o que falta.
- Endereço: o texto vira rascunho pelo caminho de sempre (confirmação); "outro endereço" sem texto apaga o endereço e mostra `chooseAddress` ou `askNewAddress`.
- Dúvida sem campo válido → resposta fixa com o telefone da revenda e repete a pergunta. Mensagem sem relação com o pedido → "Não entendi."

**Identificação primeiro.** Na primeira mensagem, o que foi dito fica guardado (produto, quantidade, pagamento e
endereço como texto pendente) e o `start` segue: cliente novo dá nome e CPF; cadastrado confirma os 3 primeiros dígitos do CPF. A saudação (boas-vindas) vem primeiro, depois o "Anotado: ..." e a pergunta seguinte. Em `askName`, texto com palavra de pedido vale como nome só quando a IA responde com confiança que não é pedido nem pergunta e o texto é um nome válido; com a IA fora do ar ou incerta, o bot diz "Não entendi" e pede o nome de novo. Texto
livre em `askName`/`askCpf`/`askCpfPrefix` anota os campos, mas repete a pergunta de identificação. Quando o
cliente fica conhecido, o produto guardado é conferido de novo com a lista dele e descartado se não estiver nela.

## Atalhos e transições especiais

- **Fora de ordem (passos 3–5):** se o cliente escreve "2 botijões no Pix pra mesma casa", a IA extrai tudo de uma vez e o bot só pergunta o que faltou (ver [Texto livre e fallback](#texto-livre-e-fallback)).
- **Repetir último pedido:** cliente conhecido e verificado pode ir direto do passo 2 para o passo 6 (ver [Repetir último pedido](#repetir-último-pedido)).
- **Pedido de atendente:** de qualquer estado, resposta fixa com o telefone da revenda; o estado não muda.
- **Pedido de desconto:** resposta fixa ("o preço é o da tabela"); o estado não muda.
- **Dúvida no meio do fluxo:** resposta fixa com o telefone da revenda e repete a pergunta; o estado não muda. FAQ com IA é melhoria futura.
- **Expiração e lembrete:** o estado no Redis tem TTL de 15 min; se o cliente sumir, o carrinho expira. Aos 10 min sem mensagem, o bot manda um lembrete (ver [Lembrete de pedido parado](#lembrete-de-pedido-parado)).
- **Fallback da IA:** se a IA falhar, demorar ou não entender, o bot diz "Não entendi." e repete a pergunta com os botões do estado atual.

## Observações sobre o fluxo

- O diagrama não mostra o atalho "repetir último pedido" nem a saída da verificação (telefone da revenda); eles só aparecem no texto.
- "Corrigir" sempre volta ao passo 3. Vale perguntar *o que* corrigir (produto, endereço ou pagamento) e voltar só àquele passo.
- O passo 8 promete "tempo estimado", mas a API não fornece esse dado nem webhook de status: dá para informar só o status e o entregador, consultando a venda.
- O preço vem dos acordos da RevGás e pode depender da forma de pagamento. Se depender, o passo 3 mostra no máximo um preço de referência e o total definitivo só sai no passo 6, depois do pagamento.
