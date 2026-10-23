import type { Address } from 'src/modules/address/contracts/address.types';
import type { Product } from 'src/modules/catalog/contracts/catalog.types';
import { formatMoney } from 'src/utils/money';
import type { OrderState } from './flow.types';

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
  welcomeNew:
    'Olá! Ainda não te conhecemos. Para fazer seu pedido, preciso de alguns dados.\nQual é o seu nome completo?',
  welcomeBack: (name: string) => `Olá, ${name}! Vamos fazer seu pedido.`,
  askName: 'Qual é o seu nome completo?',
  invalidName: 'Preciso do nome completo, com nome e sobrenome. Qual é o seu nome?',
  askCpf: 'Agora seu CPF (só números):',
  invalidCpf: 'Esse CPF não parece válido. Confira e mande de novo (só números).',
  askCpfPrefix: 'Olá! Para sua segurança, digite os 3 primeiros dígitos do seu CPF.',
  cpfPrefixMismatch: 'Não confere. Digite os 3 primeiros dígitos do seu CPF.',
  cpfPrefixFormat: 'Digite só os 3 primeiros dígitos do seu CPF.',
  identityContactStore: (phone?: string) =>
    `Não consegui confirmar seus dados por aqui. ${storeContact(phone)}`,
  cpfTaken: (phone?: string) =>
    `Esse CPF já tem cadastro com outro telefone. ${storeContact(phone)}`,
  registerFailed:
    'Não consegui concluir seu cadastro. Confira seus dados e vamos tentar de novo.\nQual é o seu nome completo?',
  chooseAddress: 'Para onde vai o gás?',
  viewAddresses: 'Ver endereços',
  otherAddress: 'Outro endereço',
  askNewAddress: 'Qual o endereço de entrega? Mande o CEP ou o endereço completo.',
  cepNotFound: 'Não encontrei esse CEP. Mande o CEP de novo ou o endereço completo.',
  askStreet: 'Qual é a rua?',
  askNumber: 'Qual é o número? Se não tiver, mande S/N.',
  askNeighborhood: 'Qual é o bairro?',
  didNotUnderstandAddress: 'Não consegui entender. Me manda o CEP?',
  confirmAddress: (address: Address) => `É esse o endereço?\n${addressFull(address)}`,
  addressOk: 'Está certo',
  addressRetype: 'Corrigir',
  chooseProduct: 'Qual produto você quer?',
  viewProducts: 'Ver produtos',
  searchByName: 'Buscar pelo nome',
  askProductSearch: 'Digite parte do nome do produto que você procura.',
  productNotFound: 'Não encontrei nenhum produto com esse nome. Tente outro nome.',
  chooseQuantity: (product: Product) => `Quantos ${product.name} você quer?`,
  otherQuantity: 'Outra',
  askQuantity: 'Mande a quantidade (um número inteiro, 1 ou mais).',
  invalidQuantity: 'Não entendi a quantidade. Mande um número inteiro, 1 ou mais.',
  choosePayment: 'Como você vai pagar?',
  viewPayments: 'Ver formas',
  noPriceForPayment: 'Não temos preço para essa forma de pagamento. Escolha outra.',
  askNeedsChange: (total: number) => `Total: ${formatMoney(total)}. Vai precisar de troco?`,
  noChangeNeeded: 'Não preciso',
  needsChange: 'Sim',
  askChangeAmount: 'Troco para quanto?',
  invalidChange: (total: number) =>
    `O valor precisa ser maior que o total de ${formatMoney(total)}. Troco para quanto?`,
  summary: (state: OrderState) =>
    [
      'Confira seu pedido:',
      `${state.quantity}× ${state.product?.name ?? ''}`,
      state.address ? addressLabel(state.address) : '',
      paymentLine(state),
      `Total: ${formatMoney(state.quote?.total ?? 0)}`,
    ].join('\n'),
  confirm: 'Confirmar',
  fix: 'Corrigir',
  chooseCorrection: 'O que você quer corrigir?',
  fixProduct: 'Produto',
  fixAddress: 'Endereço',
  fixPayment: 'Pagamento',
  saleCreated: (id: number) => `Pedido nº ${id} confirmado! Já estamos separando seu gás.`,
  saleFailed: 'Não consegui registrar seu pedido agora.',
  saleRejected: (phone?: string) => `Não foi possível registrar seu pedido. ${storeContact(phone)}`,
  retry: 'Tentar de novo',
  saleInProgress: 'Estou registrando seu pedido, só um instante.',
  cancelled: 'Pedido cancelado. É só mandar mensagem quando quiser pedir.',
  talkToStore: (phone?: string) => storeContact(phone),
  noDiscount: 'O preço é o da tabela da revenda.',
  offTopic: (phone?: string) =>
    `Essa dúvida eu não consigo responder por aqui. ${storeContact(phone)}`,
  notUnderstood: 'Não entendi.',
  chooseAmbiguousProduct: 'Qual desses você quer?',
  noted: (parts: string[]) => `Anotado: ${parts.join(', ')}.`,
  textOnly: 'Por enquanto só entendo texto e os botões.',
  unavailable: 'Estou com instabilidade agora, tenta de novo em instantes.',
  addressLabel,
  addressFull,
};
