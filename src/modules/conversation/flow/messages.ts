import type { Address } from 'src/modules/address/contracts/address.types';
import type { BasePrice, Product } from 'src/modules/catalog/contracts/catalog.types';
import { formatMoney } from 'src/utils/money';
import type { Opening, ServiceWindow } from 'src/utils/service-hours';
import { MAX_QUANTITY, type OrderState, type RepeatOffer } from './flow.types';

function storeContact(phone?: string): string {
  return phone ? `Fale com a revenda: ${phone}.` : 'Fale direto com a revenda.';
}

function addressLabel(address: Address): string {
  return `${address.street}, ${address.number} – ${address.neighborhood}`;
}

function addressFull(address: Address): string {
  return `${addressLabel(address)}, ${address.city}/${address.state}`;
}

export function paymentLine(state: OrderState): string {
  const label = state.payment?.label ?? '';
  if (state.payment?.type === 'MONEY' && state.changeFor) {
    return `${label} (troco para ${formatMoney(state.changeFor)})`;
  }
  return label;
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function openingWhen(opening: Opening): string {
  const [hours, minutes] = opening.time.split(':');
  const time = `${Number(hours)}h${minutes === '00' ? '' : minutes}`;
  if (opening.inDays === 0) return `hoje às ${time}`;
  if (opening.inDays === 1) return `amanhã às ${time}`;
  return `${WEEKDAYS[opening.weekday]} às ${time}`;
}

const SHORT_DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

function clock(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

function dayHours(windows: ServiceWindow[], day: number): string {
  return joinList(
    windows
      .filter(window => window.day === day)
      .sort((a, b) => a.start - b.start)
      .map(window => `${clock(window.start)} às ${clock(window.end)}`),
  );
}

function dayRange(days: number[]): string {
  const names = days.map(day => SHORT_DAYS[day]);
  if (names.length <= 2) return joinList(names);
  return `${names[0]} a ${names.at(-1)}`;
}

function formatWindows(windows: ServiceWindow[]): string {
  const groups: { days: number[]; hours: string }[] = [];
  let previous: number | null = null;
  for (const day of WEEK_ORDER) {
    const hours = dayHours(windows, day);
    if (!hours) {
      previous = null;
      continue;
    }
    const last = groups.at(-1);
    if (last && previous !== null && last.hours === hours) last.days.push(day);
    else groups.push({ days: [day], hours });
    previous = day;
  }
  return groups.map(group => `${dayRange(group.days)}, ${group.hours}`).join('; ');
}

function priceLine({ product, minPrice, varies }: BasePrice): string {
  const price = formatMoney(minPrice);
  return `- ${product.name}: ${varies ? `a partir de ${price}` : price}`;
}

export const msg = {
  welcomeNew:
    'Olá! Ainda não te conhecemos. Para fazer seu pedido, preciso de alguns dados.\nQual é o seu nome completo?',
  welcomeBack: (name: string) => `Olá, ${name}! Vamos fazer seu pedido.`,
  offerRepeat: (offer: RepeatOffer) =>
    `Quer repetir seu último pedido?\n${offer.quantity}× ${offer.product.name} · ${offer.payment.label}\n${addressLabel(offer.address)}`,
  repeatOrder: 'Repetir',
  newOrder: 'Novo pedido',
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
  stockLimit: (stock: number, product: string) =>
    `Temos só ${stock} ${stock === 1 ? 'unidade' : 'unidades'} de ${product} agora.`,
  quantityAboveMax: `Pedidos acima de ${MAX_QUANTITY} unidades são atendidos por um atendente.`,
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
  talkToAgent: 'Falar com atendente',
  orderStart: 'Fazer pedido',
  wantToOrder: 'Quer fazer um pedido?',
  wantAgentOrOrder: 'Quer falar com um atendente ou fazer um pedido?',
  emergency:
    'Se você sente cheiro de gás ou suspeita de vazamento: feche o registro do botijão, não acenda fogo nem mexa em interruptores ou tomadas, abra portas e janelas, saia do local e ligue para os Bombeiros no 193.',
  handoffQueued: 'Já chamei um atendente. Enquanto isso, posso continuar te ajudando por aqui.',
  handoffAlreadyQueued: 'Você já está na fila, um atendente vai te chamar.',
  handoffClosed: (opening: Opening | null) =>
    opening
      ? `Estamos fechados agora. Abrimos ${openingWhen(opening)}. Quando abrirmos, mande um "oi" aqui que um atendente te responde.`
      : 'Estamos fechados agora. Quando abrirmos, mande um "oi" aqui que um atendente te responde.',
  noDiscount: 'O preço é o da tabela da revenda.',
  offTopicRefusal:
    'Sou o assistente da revenda: posso te ajudar com pedidos e dúvidas sobre gás e entrega.',
  offense: 'Vamos manter a conversa respeitosa. Posso te ajudar com seu pedido de gás.',
  notKnown: 'Não tenho essa informação. Quer falar com um atendente?',
  questionInvite:
    'Claro! Pode perguntar. Consigo te ajudar com horário, entrega, formas de pagamento, vale-gás, troca de botijão e segurança.',
  capabilities: (topics: string[]) =>
    ['Posso tirar dúvidas sobre:', ...topics.map(topic => `- ${topic}`), 'É só perguntar.'].join(
      '\n',
    ),
  offerAgent: 'Se quiser falar com um atendente, é só tocar no botão.',
  deliveryFee:
    'Não tenho o valor da entrega por aqui. O resumo do pedido mostra o total antes de você confirmar. Quer falar com um atendente?',
  stuck: 'Não estou conseguindo entender. Quer falar com um atendente?',
  noServiceHours:
    'Não tenho o horário de atendimento cadastrado aqui. Quer falar com um atendente?',
  noPrice: 'Não consegui consultar os preços agora. Quer falar com um atendente?',
  serviceHours: (windows: ServiceWindow[], open: boolean) =>
    `Nosso horário de atendimento: ${formatWindows(windows)}.\n${open ? 'Estamos abertos agora.' : 'Estamos fechados agora.'}`,
  paymentsAccepted: (labels: string[]) => `Aceitamos: ${joinList(labels)}.`,
  prices: (list: BasePrice[]) =>
    ['Preços de hoje:', ...list.map(priceLine), 'O total aparece no resumo do pedido.'].join('\n'),
  notCarried: (item: string | null) => (item ? `Não temos ${item}.` : 'Não temos esse produto.'),
  notSold: (item: string | null, products: string[]) => {
    const missing = msg.notCarried(item);
    return products.length > 0 ? `${missing} Temos: ${joinList(products)}.` : missing;
  },
  notUnderstood: 'Não entendi.',
  chooseAmbiguousProduct: 'Qual desses você quer?',
  noted: (parts: string[]) => `Anotado: ${parts.join(', ')}.`,
  textOnly: 'Por enquanto só entendo texto e os botões.',
  unavailable: 'Estou com instabilidade agora, tenta de novo em instantes.',
  reminder: 'Ainda está aí? Seu pedido fica guardado por mais 5 minutos.',
  addressLabel,
  addressFull,
  busy: 'Ainda estou cuidando da sua mensagem anterior. Manda essa de novo em instantes.',
};
