# Design — Pedido em texto livre (F03) e fallback de intenção

Data: 2026-10-22 · Status: rascunho para aprovação

## Intenção

Hoje o bot só entende botões, listas e as respostas digitadas que cada etapa espera (nome, CPF,
quantidade, CEP...). Se o cliente escreve "oi, quero 2 botijão no pix" ou, no meio do pedido, "na
verdade quero 3 e entrega na casa da minha mãe", o bot ignora o que foi dito e repete a pergunta.

Esta entrega faz o bot **aproveitar o que o cliente escreve**: a IA lê o texto, o backend guarda o que
for válido (produto, quantidade, pagamento, endereço) e o bot pergunta **só o que falta**. Quando a
mensagem não tem nada a ver com o pedido, o bot responde curto e repete a pergunta da etapa.

Cobre F03 e o fallback de intenção de `docs/project/funcionalidades.md` (contrato `interpretar()` de
`docs/project/specs.md`).

## Decisões do usuário

- **Primeira mensagem com pedido:** o bot guarda produto, quantidade e pagamento ditos e segue pedindo
  só o que falta. **A identificação vem primeiro**: cliente novo dá nome e CPF; cliente cadastrado sem
  CPF dá o CPF. Só depois o bot segue para o que falta do pedido.
- **Vale em qualquer etapa:** o que o cliente disser em texto livre **substitui** o que já estava no
  pedido. Ex.: na etapa de pagamento, "na verdade quero 3, e entrega na casa da minha mãe" → quantidade
  vira 3 e o bot pede o novo endereço.
- **Mensagem fora do pedido** (dúvida, "kkkk"): resposta curta fixa e repete a pergunta da etapa atual.
  Sem emoji. O FAQ com IA (F06) **não** entra agora.
- **Produto ambíguo** ("um botijão" com P13 e P45): mostra uma lista só com os produtos que batem.
- **Etapas de texto digitado** (nome, CPF, quantidade, troco): se a mensagem tiver **número ou palavra
  de pedido**, vai para a IA em vez de virar a resposta da etapa.
- Botões e palavras-chave continuam funcionando sem IA, exatamente como hoje.

## Textos novos (em `flow/messages.ts`, sem emoji)

| Chave sugerida | Texto |
| --- | --- |
| `offTopic(phone)` | "Essa dúvida eu não consigo responder por aqui. Fale com a revenda: (telefone)." (reusa `storeContact`) |
| `notUnderstood` | "Não entendi." |
| `chooseAmbiguousProduct` | "Qual desses você quer?" |
| `noted(...)` | "Anotado: " + o que mudou, ex. "Anotado: 3x Botijão P13, entrega em outro endereço." |

Depois de `offTopic` e `notUnderstood` vem sempre a pergunta da etapa atual (o mesmo `repeatQuestion`
de `global-commands.ts`).

## Objetivos

- Cliente manda "quero 2 botijão P13 no pix" na primeira mensagem → depois da identificação e do
  endereço, o bot vai direto ao resumo (ou ao troco), sem perguntar produto, quantidade nem pagamento.
- Texto livre no meio do fluxo atualiza o pedido e o fluxo retoma no que falta.
- Mensagem sem relação com o pedido nunca quebra o fluxo nem muda o estado.
- Tudo testável com `createFakeTools` (sem IA real), como o resto do fluxo (RNF08).

## Não objetivos

- FAQ com IA (F06), status do pedido (F05), repetir último pedido (F04).
- Mais de um produto ou mais de uma forma de pagamento por pedido (continua um de cada).
- Extrair valor de troco do texto livre ("troco pra 100"): o troco continua perguntado na etapa própria.
- Usar IA nas etapas que já recebem texto livre por natureza: `askNewAddress`, `askAddressField`
  (endereço, já usa a IA de endereço) e `searchProduct` (busca por nome). Elas ficam como estão.

## Anti-objetivos (falha mesmo se "funcionar")

- Preço, total ou troco vindo da IA (RN06, G05). A IA só aponta **qual** produto/pagamento; o preço
  continua saindo de `tools.quote`.
- Produto ou pagamento que **não está na lista da revenda** entrar no pedido. Toda saída da IA é
  conferida contra `listProducts` / `listPaymentOptions`; o que não bater é descartado.
- CPF ou telefone no prompt, ou qualquer dado do estado/cadastro do cliente (G02, RNF03). O texto vai
  para a IA com CPFs removidos (mesmo padrão de `address.service.ts`). O backend nunca acrescenta
  nome, telefone ou endereço salvo ao prompt. Se o próprio cliente escreveu o nome na mensagem (ex.:
  "João Silva, quero 2 botijão" em `askName`), ele vai junto: G02 proíbe dados de **outros** clientes,
  e a IA de endereço já recebe texto livre do mesmo jeito. **Decisão minha.**
- Instrução do cliente mudar o comportamento ("ignore as regras...") (G03): a saída é um objeto Zod
  fixo, nunca texto livre da IA para o cliente.
- Conversa típica com botões passar a chamar a IA (RNF09). A IA só é chamada quando a etapa não
  entendeu a mensagem.
- Fluxo travar porque a IA falhou ou demorou (RNF06).
- Criar venda sem o cliente tocar em **Confirmar** no resumo: texto livre nunca pula o resumo.

## Como funciona

### 1. Quando a IA é chamada

| Situação | Comportamento |
| --- | --- |
| Botão/lista/palavra-chave que a etapa entende | Igual hoje. Sem IA. |
| Comandos globais (cancelar, atendente, desconto) | Igual hoje, antes de tudo. Sem IA. |
| **Etapa de botão** (`chooseAddress`, `confirmAddress`, `chooseProduct`, `chooseQuantity`, `choosePayment`, `askNeedsChange`, `summary`, `chooseCorrection`) recebe texto que não entende | IA |
| `askName` | Se o texto tem dígito ou palavra de pedido → IA. Senão, validação de nome de hoje. |
| `askCpf`, `askMissingCpf`, `askQuantity`, `askChangeAmount` | Primeiro a validação de hoje (CPF válido / número). Se falhar: texto só com dígitos e pontuação → mensagem de erro de hoje; senão, se tem dígito ou palavra de pedido → IA; senão → erro de hoje. |
| **Primeira mensagem** (sem estado) | Se tem dígito ou palavra de pedido → IA antes do `start`. Senão ("oi") → `start` de hoje, sem IA. |
| `askNewAddress`, `askAddressField`, `searchProduct` | Igual hoje (fora do escopo). |
| `creatingSale`, `saleFailed` | Nunca chama a IA. |

**Palavras de pedido** (lista fixa, comparada depois de `normalizeText`): quero, queria, manda, mande,
pedir, pedido, botijao, gas, agua, pix, cartao, credito, debito, dinheiro, entrega, entregar, endereco,
casa, rua — **mais** as palavras dos nomes dos produtos curados. A lista exata é do construtor; o
critério é "barata, sem rede, erra para o lado de chamar a IA só quando há sinal de pedido".

### 2. O que a IA devolve

Nova ferramenta em `FlowTools`:

```ts
interpret(text: string, context: InterpretContext): Promise<Interpretation | null>
```

- `context` traz só dados não sensíveis: nomes dos produtos oferecidos (`productOptions` ou
  `listProducts`) e os rótulos/tipos das formas de pagamento (`listPaymentOptions`). Nada do cliente.
- `null` = IA falhou, demorou ou devolveu algo inválido.

`Interpretation` (validada com Zod; nomes em inglês, finais a critério do construtor):

```ts
{
  intent: 'order' | 'question' | 'other'
  products?: string[]      // nomes copiados da lista enviada; vários = ambíguo
  quantity?: number        // inteiro >= 1
  payment?: string         // `type` copiado da lista enviada
  address?: string         // trecho do endereço como o cliente escreveu
  newAddress?: boolean     // "outro endereço", "casa da minha mãe" sem dizer qual
  confidence: number       // 0..1
}
```

Implementação: um serviço novo em `src/modules/assistant/` (nome já previsto em `specs.md`), que usa
`LLM_CLIENT.generateObject` com `temperature: 0`, igual a `AddressService`. `flow-tools.ts` liga
`interpret` a esse serviço. As etapas continuam sem importar nada fora de `flow/`, `src/utils` e
`contracts/`.

### 3. Como o resultado vira pedido

Uma função compartilhada do fluxo (ex.: `flow/free-text.ts`), chamada pelas etapas no ramo "não
entendi", aplica o resultado:

1. `null` (IA falhou) ou `confidence` abaixo do limiar → `notUnderstood` + pergunta da etapa. Estado
   não muda. **Minha decisão:** limiar 0,6, numa constante.
2. `intent = 'question'` **sem nenhum campo válido** → `offTopic(storePhone)` + pergunta da etapa.
   Estado não muda. Com campos válidos ("quanto custa? quero 2 no pix"), **os campos ganham**: segue o
   item 4 e a dúvida é ignorada. **Decisão minha.**
3. `intent = 'other'` sem nenhum campo → `notUnderstood` + pergunta da etapa.
4. `intent = 'order'` (ou qualquer intent com campos válidos) → aplica os campos, **substituindo**:
   - **Produto:** filtra `products` pelos que existem na lista. 1 → vira `product`. Vários → lista só
     com eles, "Qual desses você quer?". Nenhum → ignora. **Decisões minhas** sobre a lista ambígua:
     a quantidade e o pagamento ditos na mesma mensagem **são mantidos** quando o cliente escolhe da
     lista (não pergunta a quantidade de novo); se o cliente responder algo inválido ou fora do pedido,
     a pergunta repetida é a **lista filtrada**, não a completa. Isso pede um caminho próprio (ex.:
     guardar os candidatos no estado) sem mudar o `selectProduct` usado pelas outras etapas.
   - **Quantidade:** inteiro ≥ 1 → `quantity`.
   - **Pagamento:** `type` que existe em `listPaymentOptions` → `payment`; senão ignora.
   - **Endereço:** `address` com texto (rua, número, bairro ou CEP) → apaga `address` e guarda o texto
     para virar rascunho pelo caminho de hoje (`addressFromText` → campos faltantes →
     `confirmAddress`). `newAddress` sem texto ("casa da minha mãe", "em casa") → apaga `address` e
     segue o `nextStep` de hoje: cliente com endereços salvos vê `chooseAddress` (salvos + "Outro
     endereço"); sem salvos, `askNewAddress`. Não há busca do texto entre os endereços salvos.
     **Decisão minha.** (Cliente cadastrado que confirma um endereço novo não gera cadastro novo na
     RevGás: `createCustomer` só roda para cliente sem `id`; o endereço vai só na venda, como hoje.)
   - Mesmas limpezas de hoje: trocar produto limpa `quantity` e `quote` **só se a mensagem não trouxe
     quantidade**; trocar quantidade limpa `quote`; trocar pagamento limpa `quote` e `changeFor`.
   - Manda `noted(...)` com o que mudou e segue com `nextStep` (que pergunta o que falta e, com tudo
     preenchido, volta ao resumo).
   - Se nenhum campo válido sobrou depois da conferência → igual ao item 3.

### 4. Identificação primeiro

- Primeira mensagem com pedido: o resultado da IA fica guardado no estado e o `start` de hoje roda.
  Cliente novo vai para `askName`; cadastrado sem CPF para `askMissingCpf`; cadastrado com CPF segue
  para `nextStep`, que já pula o que foi preenchido.
- Endereço dito por **cliente novo** antes de se identificar: fica guardado como texto pendente. Depois
  do CPF, o `nextStep` usa esse texto (rascunho → confirmação) em vez de perguntar o endereço do zero.
  O cadastro na RevGás continua acontecendo no `confirmAddress`, como hoje.
- Texto livre em `askName`/`askCpf`/`askMissingCpf` aplica os campos mas **não pula a identificação**:
  depois do `noted(...)` o bot repete a pergunta de identificação da etapa.
- **Reconferência depois da identificação (decisão minha):** antes da identificação, produto e
  pagamento são conferidos com o cliente anônimo (`listProducts({})`), mas a lista depende dos acordos
  do cliente/categoria. Quando o cliente fica conhecido (fim do `start` com cadastro, ou depois do
  `confirmAddress` de cliente novo), o produto guardado é reconferido com `listProducts` do cliente. Se
  não estiver mais na lista, é descartado em silêncio e o `nextStep` pergunta o produto. Pagamento sem
  preço já é tratado hoje pelo `quote` ("Não temos preço para essa forma de pagamento").

### 4b. Rascunho de endereço em andamento

Se o texto livre chega em `confirmAddress` (ou em outra etapa com `draftAddress` preenchido) e não
mexe no endereço, o rascunho **é retomado**: o `nextStep` passa a olhar `draftAddress` antes de
`chooseAddress`/`askNewAddress` (campo faltante → `askAddressField`; completo → `confirmAddress`).
**Decisão minha.**

### 5. IA falhou ou demorou

Usa o timeout que já existe (`LLM_TIMEOUT_MS`). Qualquer falha → `interpret` devolve `null` →
`notUnderstood` + pergunta da etapa (com os botões). O pedido nunca depende da IA (RNF06).

## Testes

- `free-text` e as etapas: `createFakeTools` ganha `interpret` configurável. Casos mínimos: primeira
  mensagem com pedido completo (cliente novo e cadastrado), troca de quantidade + novo endereço no meio,
  produto ambíguo, produto/pagamento fora da lista descartado, dúvida, "kkkk", IA retornando `null`,
  nome com número indo para a IA, CPF válido não indo para a IA, `creatingSale` ignorando texto.
- Serviço do assistant: com `FakeLlmClient`, saída inválida → `null`, `LlmError` → `null`, CPF removido
  do texto enviado.

## Documentação a atualizar

- `docs/project/funcionalidades.md`: F03 entregue. **F04 e F05 ficam pendentes no MVP.** F06, F07,
  F08, F09, F10, F11, F12, F13 e RN13 passam para "Melhorias futuras (fora do escopo atual)".
- `docs/project/requisitos.md`: RF10 (FAQ) e RN13 (salvar venda no Postgres) marcados como melhoria
  futura; decisão de 2026-10-22 registrada.
- `docs/project/fluxo.md`: seção "Texto livre e fallback" com a tabela de quando a IA é chamada;
  remover "Dúvida no meio do fluxo (FAQ): responde" (passa a ser resposta fixa).
- `docs/project/specs.md`: contrato real de `interpret` no lugar do `interpretar()` proposto;
  `responderFaq()` marcado como futuro.
- `CLAUDE.md`: `modules/assistant/` na árvore de arquitetura e `interpret` em `FlowTools`.

## Fica a critério do construtor

- Nomes finais de tipos, arquivos e chaves de mensagem.
- Texto do prompt (seguindo G01–G05) e lista exata de palavras de pedido.
- Como montar o texto do `noted(...)`.
- Se a chamada à IA fica em cada etapa ou num ponto único do `runFlow`, desde que a regra da tabela da
  seção 1 valha e cada etapa continue legível sozinha.
