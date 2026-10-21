import type { Address } from 'src/modules/address/contracts/address.types';
import type { PaymentOption, Product } from 'src/modules/catalog/contracts/catalog.types';
import { formatMoney } from 'src/utils/money';
import type { Reply, ReplyOption } from '../contracts/conversation.types';
import type { OrderState } from './flow.types';
import { fit as shorten } from './input';

const BUTTON_TITLE = 20;
const ROW_TITLE = 24;
const ROW_DESCRIPTION = 72;
const LIST_ROWS = 10;

function text(value: string): Reply {
  return { type: 'text', text: value };
}

function buttons(body: string, options: ReplyOption[]): Reply {
  return {
    type: 'buttons',
    body,
    buttons: options.map(option => ({ id: option.id, title: shorten(option.title, BUTTON_TITLE) })),
  };
}

function list(body: string, buttonText: string, rows: ReplyOption[]): Reply {
  return {
    type: 'list',
    body,
    buttonText,
    sections: [
      {
        rows: rows.map(row => ({
          id: row.id,
          title: shorten(row.title, ROW_TITLE),
          ...(row.description ? { description: shorten(row.description, ROW_DESCRIPTION) } : {}),
        })),
      },
    ],
  };
}

function storeContact(phone?: string): string {
  return phone ? `Fale com a revenda: ${phone}.` : 'Fale direto com a revenda.';
}

function addressLabel(address: Address): string {
  return `${address.street}, ${address.number} – ${address.neighborhood}`;
}

function addressFull(address: Address): string {
  return `${addressLabel(address)}, ${address.city}/${address.state}`;
}

function paymentLine(state: OrderState): string {
  const label = state.payment?.label ?? '';
  if (state.payment?.type === 'MONEY' && state.changeFor) {
    return `${label} (troco para ${formatMoney(state.changeFor)})`;
  }
  return label;
}

export const msg = {
  welcomeNew: text(
    'Olá! Ainda não te conhecemos. Para fazer seu pedido, preciso de alguns dados.\nQual é o seu nome completo?',
  ),
  welcomeBack: (name: string): Reply => text(`Olá, ${name}! Vamos fazer seu pedido.`),
  askName: text('Qual é o seu nome completo?'),
  invalidName: text('Preciso do nome completo, com nome e sobrenome. Qual é o seu nome?'),
  askCpf: text('Agora seu CPF (só números):'),
  invalidCpf: text('Esse CPF não parece válido. Confira e mande de novo (só números).'),
  askMissingCpf: text('Para continuar, preciso do seu CPF (só números):'),
  cpfTaken: (phone?: string): Reply =>
    text(`Esse CPF já tem cadastro com outro telefone. ${storeContact(phone)}`),
  registerFailed: text(
    'Não consegui concluir seu cadastro. Confira seus dados e vamos tentar de novo.\nQual é o seu nome completo?',
  ),
  chooseAddress: (addresses: Address[]): Reply => {
    const body = 'Para onde vai o gás?';
    if (addresses.length <= 2) {
      return buttons(body, [
        ...addresses.map((address, index) => ({
          id: `address:${index}`,
          title: addressLabel(address),
        })),
        { id: 'address:new', title: 'Outro endereço' },
      ]);
    }
    return list(body, 'Ver endereços', [
      ...addresses.slice(0, LIST_ROWS - 1).map((address, index) => ({
        id: `address:${index}`,
        title: addressLabel(address),
        description: addressFull(address),
      })),
      { id: 'address:new', title: 'Outro endereço' },
    ]);
  },
  askNewAddress: text('Qual o endereço de entrega? Mande o CEP ou o endereço completo.'),
  cepNotFound: text('Não encontrei esse CEP. Mande o CEP de novo ou o endereço completo.'),
  askStreet: text('Qual é a rua?'),
  askNumber: text('Qual é o número? Se não tiver, mande S/N.'),
  askNeighborhood: text('Qual é o bairro?'),
  didNotUnderstandAddress: text('Não consegui entender. Me manda o CEP?'),
  confirmAddress: (address: Address): Reply =>
    buttons(`É esse o endereço?\n${addressFull(address)}`, [
      { id: 'confirm:yes', title: 'Está certo' },
      { id: 'confirm:fix', title: 'Corrigir' },
    ]),
  chooseProduct: (products: Product[], boughtIds: number[] = []): Reply => {
    const body = 'Qual produto você quer?';
    const sorted = [...products].sort((a, b) => {
      const boughtA = boughtIds.includes(a.id) ? 0 : 1;
      const boughtB = boughtIds.includes(b.id) ? 0 : 1;
      return boughtA - boughtB || a.name.localeCompare(b.name, 'pt-BR');
    });
    const shown = sorted.length > LIST_ROWS ? sorted.slice(0, LIST_ROWS - 1) : sorted;
    const rows = shown.map(product => ({
      id: `product:${product.id}`,
      title: product.name,
      description: product.name,
    }));
    if (sorted.length > LIST_ROWS)
      rows.push({ id: 'product:search', title: 'Buscar pelo nome', description: '' });
    return list(body, 'Ver produtos', rows);
  },
  askProductSearch: text('Digite parte do nome do produto que você procura.'),
  productNotFound: text('Não encontrei nenhum produto com esse nome. Tente outro nome.'),
  chooseQuantity: (product: Product): Reply =>
    buttons(`Quantos ${product.name} você quer?`, [
      { id: 'qty:1', title: '1' },
      { id: 'qty:2', title: '2' },
      { id: 'qty:other', title: 'Outra' },
    ]),
  askQuantity: text('Mande a quantidade (um número inteiro, 1 ou mais).'),
  invalidQuantity: text('Não entendi a quantidade. Mande um número inteiro, 1 ou mais.'),
  choosePayment: (options: PaymentOption[]): Reply => {
    const body = 'Como você vai pagar?';
    const rows = options.map(option => ({ id: `pay:${option.type}`, title: option.label }));
    return options.length <= 3 ? buttons(body, rows) : list(body, 'Ver formas', rows);
  },
  noPriceForPayment: text('Não temos preço para essa forma de pagamento. Escolha outra.'),
  askNeedsChange: (total: number): Reply =>
    buttons(`Total: ${formatMoney(total)}. Vai precisar de troco?`, [
      { id: 'change:no', title: 'Não preciso' },
      { id: 'change:yes', title: 'Sim' },
    ]),
  askChangeAmount: text('Troco para quanto?'),
  invalidChange: (total: number): Reply =>
    text(`O valor precisa ser maior que o total de ${formatMoney(total)}. Troco para quanto?`),
  summary: (state: OrderState): Reply => {
    const lines = [
      'Confira seu pedido:',
      `${state.quantity}× ${state.product?.name ?? ''}`,
      state.address ? addressLabel(state.address) : '',
      paymentLine(state),
      `Total: ${formatMoney(state.quote?.total ?? 0)}`,
    ];
    return buttons(lines.join('\n'), [
      { id: 'summary:confirm', title: 'Confirmar' },
      { id: 'summary:fix', title: 'Corrigir' },
    ]);
  },
  chooseCorrection: buttons('O que você quer corrigir?', [
    { id: 'fix:product', title: 'Produto' },
    { id: 'fix:address', title: 'Endereço' },
    { id: 'fix:payment', title: 'Pagamento' },
  ]),
  saleCreated: (id: number): Reply =>
    text(`Pedido nº ${id} confirmado! Já estamos separando seu gás.`),
  saleFailed: buttons('Não consegui registrar seu pedido agora.', [
    { id: 'summary:retry', title: 'Tentar de novo' },
  ]),
  saleInProgress: text('Estou registrando seu pedido, só um instante.'),
  cancelled: text('Pedido cancelado. É só mandar mensagem quando quiser pedir.'),
  talkToStore: (phone?: string): Reply => text(storeContact(phone)),
  noDiscount: text('O preço é o da tabela da revenda.'),
  textOnly: text('Por enquanto só entendo texto e os botões.'),
  unavailable: text('Estou com instabilidade agora, tenta de novo em instantes.'),
  addressLabel,
  addressFull,
};
