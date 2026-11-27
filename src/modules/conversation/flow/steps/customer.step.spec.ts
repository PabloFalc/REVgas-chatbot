import { describe, expect, it, vi } from 'vitest';
import { type FlowInput, type OrderState, ToolError } from '../flow.types';
import { offer } from '../handoff';
import { msg } from '../messages';
import { buttons, text } from '../replies';
import { createFakeTools, FAKE_PHONE } from '../testing/fake-tools';
import { asks, handlers, start } from './customer.step';
import './index';

const say = (body: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'text', text: body },
});

const VALID_CPF = '123.456.789-09';
const OTHER_CPF = '987.654.321-00';
const unverified = { verifiedCustomer: async () => null };
const ownerChanged = { id: 'identity:owner-changed', title: 'Número mudou de dono' };
const agent = { id: 'identity:agent', title: 'Falar com atendente' };
const identityHandoffReplies = () => [text(msg.identityHandoff), text(msg.handoffQueued)];
const choose = (id: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'choice', id },
});
const handoffRequests = (tools: ReturnType<typeof createFakeTools>) =>
  tools.calls.filter(call => call.name === 'requestHandoff').map(call => call.args[0]);

describe('start', () => {
  it('cliente desconhecido recebe boas-vindas e vai pedir o nome', async () => {
    const result = await start({ ...say('oi'), phone: '5500000000000' }, createFakeTools());
    expect(result).toEqual({
      state: { step: 'askName', customer: {} },
      replies: [text(msg.welcomeNew)],
    });
  });

  it('em demonstração as boas-vindas avisam que os pedidos não são entregues', async () => {
    const tools = createFakeTools({ demo: true });
    const unknown = await start({ ...say('oi'), phone: '5500000000000' }, tools);
    const known = await start(say('oi'), tools);
    expect(unknown.replies).toEqual([
      text(
        'Olá! Ainda não te conhecemos. Para fazer seu pedido, preciso de alguns dados.\nEste é um atendimento de demonstração: os pedidos não são entregues.\nQual é o seu nome completo?',
      ),
    ]);
    expect(known.replies[0]).toEqual(
      text(
        'Olá, Maria da Silva! Vamos fazer seu pedido.\nEste é um atendimento de demonstração: os pedidos não são entregues.',
      ),
    );
  });

  it('cadastro sem CPF abre handoff em vez do contato da revenda', async () => {
    const tools = createFakeTools({
      ...unverified,
      findCustomers: async () => [{ id: 7, name: 'Joana Lima', cpf: null, tagId: 3 }],
    });
    const result = await start(say('oi'), tools);
    expect(result).toEqual({ state: null, replies: identityHandoffReplies() });
    expect(handoffRequests(tools)).toEqual([
      { phone: FAKE_PHONE, reason: 'identity_failure', summary: null },
    ]);
    expect(JSON.stringify(result.replies)).not.toContain('Joana');
  });

  it('telefone bloqueado vai para handoff sem pedir CPF', async () => {
    const tools = createFakeTools({ isBlocked: async () => true });
    const result = await start(say('oi'), tools);
    expect(result).toEqual({ state: null, replies: identityHandoffReplies() });
    expect(handoffRequests(tools)).toHaveLength(1);
    expect(JSON.stringify(result.replies)).not.toContain(msg.askFullCpf);
    expect(JSON.stringify(result.replies)).not.toContain('Maria');
    expect(tools.calls.map(call => call.name)).not.toContain('customerHistory');
  });

  it('sem canal humano a falha de identidade passa o contato da revenda', async () => {
    const tools = createFakeTools({
      isBlocked: async () => true,
      requestHandoff: async () => ({ status: 'unavailable', open: true, nextOpening: null }),
    });
    const result = await start(say('oi'), tools);
    expect(result).toEqual({
      state: null,
      replies: [text(msg.identityContactStore('86999990000'))],
    });
  });

  it('não verificado pede o CPF completo sem mostrar o nome', async () => {
    const tools = createFakeTools(unverified);
    const result = await start(say('oi'), tools);
    expect(result.state).toEqual({ step: 'confirmCpf', customer: {} });
    expect(result.replies).toEqual([text(msg.askFullCpf)]);
    expect(JSON.stringify(result.replies)).not.toContain('Maria');
    expect(tools.calls.map(call => call.name)).not.toContain('customerHistory');
  });

  it('cliente com vínculo carrega histórico e segue para o fluxo', async () => {
    const tools = createFakeTools();
    const result = await start(say('oi'), tools);
    expect(result.replies[0]).toEqual(text(msg.welcomeBack('Maria da Silva')));
    expect(result.state?.customer).toEqual({ id: 1, name: 'Maria da Silva', tagId: null });
    expect(result.state?.addresses).toHaveLength(2);
    expect(result.state?.boughtProductIds).toEqual([2]);
    expect(result.state?.step).toBe('chooseAddress');
    expect(tools.calls.map(call => call.name)).toEqual([
      'findCustomers',
      'isBlocked',
      'verifiedCustomer',
      'customerHistory',
    ]);
  });
});

describe('askName', () => {
  const state = { step: 'askName' as const, customer: {} };

  it('"tenho dúvidas" não vira nome: convite para perguntar e pede o nome de novo', async () => {
    const tools = createFakeTools();
    const result = await handlers.askName?.(state, say('tenho dúvidas'), tools);
    expect(result?.state).toEqual(state);
    expect(result?.replies).toEqual([text(msg.questionInvite), text(msg.askName)]);
    expect(tools.calls.map(call => call.name)).not.toContain('interpret');
  });

  it('pergunta sobre os assuntos não vira nome: lista e pede o nome de novo', async () => {
    const tools = createFakeTools();
    const result = await handlers.askName?.(state, say('me resume o que você sabe'), tools);
    expect(result?.state).toEqual(state);
    expect(result?.replies).toEqual([
      text(
        msg.capabilities(['Horário de atendimento', 'Formas de pagamento', 'Preços dos produtos']),
      ),
      text(msg.askName),
    ]);
    expect(tools.calls.map(call => call.name)).not.toContain('readName');
  });

  it('texto com palavra de pedido que a IA diz não ser pedido vira o nome', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'other', confidence: 0.9 }),
    });
    const result = await handlers.askName?.(state, say('Maria da Rua Silva'), tools);
    expect(result?.state).toMatchObject({
      step: 'askCpf',
      customer: { name: 'Maria da Rua Silva' },
    });
    expect(result?.replies).toEqual([text(msg.askCpf)]);
  });

  it('sem resposta da IA o texto de pedido não vira o nome', async () => {
    const tools = createFakeTools({ interpret: async () => null });
    const result = await handlers.askName?.(state, say('quero gás no pix'), tools);
    expect(result?.state).toMatchObject({ step: 'askName' });
    expect(result?.state?.customer.name).toBeUndefined();
    expect(result?.replies).toEqual([text(msg.notUnderstood), text(msg.askName)]);
  });

  it('IA com pouca confiança não vira o nome', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'other', confidence: 0.3 }),
    });
    const result = await handlers.askName?.(state, say('quero gás no pix'), tools);
    expect(result?.state?.customer.name).toBeUndefined();
  });

  it('pergunta no nome vai para a base e não vira o nome', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'question', topic: 'general', confidence: 0.9 }),
    });
    const result = await handlers.askName?.(state, say('quero saber se entregam hoje'), tools);
    expect(result?.state).toEqual(state);
    expect(result?.replies).toEqual([offer(msg.notKnown), text(msg.askName)]);
  });

  it('texto com "?" sem palavra de pedido vai para a IA e não vira o nome', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'question', topic: 'hours', confidence: 0.9 }),
      serviceHours: async () => ({
        open: true,
        nextOpening: null,
        windows: [{ day: 1, start: 480, end: 1080 }],
      }),
    });
    const spy = vi.spyOn(tools, 'interpret');
    const result = await handlers.askName?.(state, say('Vocês abrem segunda?'), tools);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result?.state).toEqual(state);
    expect(result?.replies).toEqual([
      text(msg.serviceHours([{ day: 1, start: 480, end: 1080 }], true)),
      text(msg.askName),
    ]);
  });

  it('nome sem "?" nem palavra de pedido não chama a IA', async () => {
    const tools = createFakeTools();
    const spy = vi.spyOn(tools, 'interpret');
    const result = await handlers.askName?.(state, say('Vocês Abrem Segunda'), tools);
    expect(spy).not.toHaveBeenCalled();
    expect(result?.state?.customer.name).toBe('Vocês Abrem Segunda');
  });

  it('pergunta o nome', async () => {
    const result = await asks.askName?.(state, createFakeTools());
    expect(result?.replies).toEqual([text(msg.askName)]);
  });

  it('guarda o nome e pede o CPF', async () => {
    const result = await handlers.askName?.(state, say('  Maria   da Silva '), createFakeTools());
    expect(result?.state).toEqual({ step: 'askCpf', customer: { name: 'Maria da Silva' } });
    expect(result?.replies).toEqual([text(msg.askCpf)]);
  });

  it.each(['Maria', '   ', `Ana ${'b'.repeat(100)}`])('recusa o nome %j', async raw => {
    const result = await handlers.askName?.(state, say(raw), createFakeTools());
    expect(result?.state).toBe(state);
    expect(result?.replies).toEqual([text(msg.invalidName)]);
  });

  it('nome com dígito vai para a IA e, sem resposta, repete a pergunta', async () => {
    const result = await handlers.askName?.(state, say('123 456'), createFakeTools());
    expect(result?.state).toMatchObject({ step: 'askName' });
    expect(result?.replies).toEqual([text(msg.notUnderstood), text(msg.askName)]);
  });

  describe('leitura do nome pela IA', () => {
    it('extrai o nome de uma frase natural', async () => {
      const tools = createFakeTools({
        readName: async () => ({ name: 'João Silva', isPersonName: true }),
      });
      const spy = vi.spyOn(tools, 'readName');
      const result = await handlers.askName?.(state, say('meu nome é João Silva'), tools);
      expect(spy).toHaveBeenCalledWith('meu nome é João Silva');
      expect(result?.state).toEqual({ step: 'askCpf', customer: { name: 'João Silva' } });
      expect(result?.replies).toEqual([text(msg.askCpf)]);
    });

    it('texto que não parece nome de pessoa pede o nome de novo', async () => {
      const tools = createFakeTools({
        readName: async () => ({ name: 'Fogão Azul', isPersonName: false }),
      });
      const result = await handlers.askName?.(state, say('Fogão Azul'), tools);
      expect(result).toEqual({ state, replies: [text(msg.invalidName)] });
    });

    it('sem nome no texto pede o nome de novo', async () => {
      const tools = createFakeTools({
        readName: async () => ({ name: null, isPersonName: false }),
      });
      const result = await handlers.askName?.(state, say('sei lá não sei'), tools);
      expect(result).toEqual({ state, replies: [text(msg.invalidName)] });
    });

    it('só o primeiro nome pede o nome completo', async () => {
      const tools = createFakeTools({
        readName: async () => ({ name: 'João', isPersonName: true }),
      });
      const result = await handlers.askName?.(state, say('pode me chamar de João'), tools);
      expect(result).toEqual({ state, replies: [text(msg.invalidName)] });
    });

    it('nome que não está no texto (inventado pela IA) não é aceito', async () => {
      const tools = createFakeTools({
        readName: async () => ({ name: 'Carlos Pereira', isPersonName: true }),
      });
      const result = await handlers.askName?.(state, say('meu nome é Ana Souza'), tools);
      expect(result).toEqual({ state, replies: [text(msg.invalidName)] });
    });

    it('sem IA (falha, limite ou modo fake) segue a validação de sempre', async () => {
      const tools = createFakeTools({ readName: async () => null });
      const result = await handlers.askName?.(state, say('Ana Souza'), tools);
      expect(result?.state).toEqual({ step: 'askCpf', customer: { name: 'Ana Souza' } });
    });

    it('texto longo demais não vai para a IA', async () => {
      const tools = createFakeTools();
      const spy = vi.spyOn(tools, 'readName');
      const result = await handlers.askName?.(state, say(`Ana ${'souza '.repeat(50)}`), tools);
      expect(spy).not.toHaveBeenCalled();
      expect(result?.replies).toEqual([text(msg.invalidName)]);
    });
  });

  it('recusa entrada que não é texto', async () => {
    const input: FlowInput = {
      phone: FAKE_PHONE,
      content: { type: 'choice', id: 'x', title: 'x' },
    };
    const result = await handlers.askName?.(state, input, createFakeTools());
    expect(result?.replies).toEqual([text(msg.invalidName)]);
  });
});

describe('askCpf', () => {
  const state = { step: 'askCpf' as const, customer: { name: 'Maria da Silva' } };

  it('guarda só os dígitos e segue para o endereço novo', async () => {
    const result = await handlers.askCpf?.(state, say(VALID_CPF), createFakeTools());
    expect(result?.state?.customer).toEqual({ name: 'Maria da Silva', cpf: '12345678909' });
    expect(result?.state?.step).toBe('askNewAddress');
  });

  it('CPF inválido no meio de uma frase não vai para a IA', async () => {
    const tools = createFakeTools();
    const spy = vi.spyOn(tools, 'interpret');
    const result = await handlers.askCpf?.(state, say('meu cpf é 111.222.333-44'), tools);
    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual({ state, replies: [text(msg.invalidCpf)] });
  });

  it('texto sem CPF vai para a IA sem os dígitos', async () => {
    const tools = createFakeTools();
    const spy = vi.spyOn(tools, 'interpret');
    await handlers.askCpf?.(state, say('meu cpf começa com 123, aceita pix?'), tools);
    const sent = spy.mock.calls[0]?.[0] ?? '';
    expect(sent).not.toContain('123');
    expect(sent).toContain('aceita pix?');
  });

  it('CPF inválido não repete o número digitado', async () => {
    const result = await handlers.askCpf?.(state, say('111.222.333-44'), createFakeTools());
    expect(result?.state).toBe(state);
    expect(result?.replies).toEqual([text(msg.invalidCpf)]);
    const body = JSON.stringify(result?.replies);
    expect(body).not.toContain('111');
    expect(body).not.toContain('44');
  });
});

describe('confirmCpf', () => {
  const state: OrderState = { step: 'confirmCpf', customer: {} };

  it('pede o CPF completo', async () => {
    const result = await asks.confirmCpf?.(state, createFakeTools());
    expect(result).toEqual({ state, replies: [text(msg.askFullCpf)] });
  });

  it('CPF completo correto marca verificado e dá as boas-vindas', async () => {
    const tools = createFakeTools(unverified);
    const spy = vi.spyOn(tools, 'markVerified');
    const result = await handlers.confirmCpf?.(state, say('12345678909'), tools);
    expect(spy).toHaveBeenCalledWith(FAKE_PHONE, 1);
    expect(result?.replies[0]).toEqual(text(msg.welcomeBack('Maria da Silva')));
    expect(result?.state?.customer).toEqual({ id: 1, name: 'Maria da Silva', tagId: null });
    expect(result?.state?.step).toBe('chooseAddress');
    expect(result?.state?.addresses).toHaveLength(2);
  });

  it('texto sem dígitos de CPF repete a orientação com o botão de atendente', async () => {
    const tools = createFakeTools(unverified);
    const result = await handlers.confirmCpf?.(state, say('não lembro meu documento'), tools);
    expect(result).toEqual({
      state,
      replies: [buttons(msg.askFullCpf, [agent])],
      misunderstood: true,
    });
    const names = tools.calls.map(call => call.name);
    expect(names).toContain('registerMisunderstood');
    expect(names).not.toContain('interpret');
  });

  it('CPF com pontuação confere com o cadastro', async () => {
    const tools = createFakeTools(unverified);
    const result = await handlers.confirmCpf?.(state, say(`meu cpf é ${VALID_CPF}`), tools);
    expect(tools.calls.map(call => call.name)).toContain('markVerified');
    expect(result?.state?.step).toBe('chooseAddress');
  });

  it('com dois cadastros no telefone, o CPF escolhe o cadastro certo', async () => {
    const tools = createFakeTools({
      ...unverified,
      findCustomers: async () => [
        { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
        { id: 2, name: 'João Souza', cpf: '98765432100', tagId: 4 },
      ],
    });
    const spy = vi.spyOn(tools, 'markVerified');
    const result = await handlers.confirmCpf?.(state, say(OTHER_CPF), tools);
    expect(spy).toHaveBeenCalledWith(FAKE_PHONE, 2);
    expect(result?.replies[0]).toEqual(text(msg.welcomeBack('João Souza')));
    expect(JSON.stringify(result)).not.toContain('Maria');
  });

  it('CPF que não confere oferece os botões e não revela o motivo', async () => {
    const tools = createFakeTools({
      ...unverified,
      findCustomers: async () => [
        { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
        { id: 2, name: 'João Souza', cpf: '11144477735', tagId: null },
      ],
    });
    const spy = vi.spyOn(tools, 'registerCpfMismatch');
    const result = await handlers.confirmCpf?.(state, say(OTHER_CPF), tools);
    expect(spy).toHaveBeenCalledWith(FAKE_PHONE);
    expect(result).toEqual({
      state,
      replies: [buttons(msg.cpfMismatch, [ownerChanged, agent])],
    });
    const body = JSON.stringify(result?.replies);
    for (const hidden of ['Maria', 'João', 'cadastros', '987', '123']) {
      expect(body).not.toContain(hidden);
    }
    expect(tools.calls.map(call => call.name)).not.toContain('markVerified');
    expect(handoffRequests(tools)).toEqual([]);
  });

  it('terceiro erro bloqueia e abre handoff de identidade', async () => {
    const tools = createFakeTools({ ...unverified, registerCpfMismatch: async () => 3 });
    const result = await handlers.confirmCpf?.(state, say(OTHER_CPF), tools);
    expect(result).toEqual({ state: null, replies: identityHandoffReplies() });
    expect(handoffRequests(tools)).toEqual([
      {
        phone: FAKE_PHONE,
        reason: 'identity_failure',
        summary: {
          stepLabel: 'Confirmação de identidade',
          identityConfirmed: false,
          newCustomer: false,
        },
      },
    ]);
  });

  it('CPF que confere com dois cadastros abre handoff', async () => {
    const tools = createFakeTools({
      ...unverified,
      findCustomers: async () => [
        { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
        { id: 2, name: 'João Souza', cpf: '12345678909', tagId: null },
      ],
    });
    const result = await handlers.confirmCpf?.(state, say(VALID_CPF), tools);
    expect(result).toEqual({ state: null, replies: identityHandoffReplies() });
    expect(handoffRequests(tools)).toHaveLength(1);
    expect(tools.calls.map(call => call.name)).not.toContain('markVerified');
    expect(JSON.stringify(result?.replies)).not.toMatch(/Maria|João/);
  });

  it('CPF inválido não conta tentativa', async () => {
    const tools = createFakeTools(unverified);
    const result = await handlers.confirmCpf?.(state, say('111.222.333-44'), tools);
    expect(result).toEqual({ state, replies: [buttons(msg.invalidCpf, [agent])] });
    expect(tools.calls.map(call => call.name)).not.toContain('registerCpfMismatch');
  });

  it('botão de atendente abre handoff de identidade', async () => {
    const tools = createFakeTools(unverified);
    const result = await handlers.confirmCpf?.(state, choose('identity:agent'), tools);
    expect(result).toEqual({ state: null, replies: identityHandoffReplies() });
    expect(handoffRequests(tools)).toMatchObject([{ reason: 'identity_failure' }]);
  });

  it('número mudou de dono segue para cadastro novo sem dado anterior', async () => {
    const tools = createFakeTools(unverified);
    const p13 = { id: 1, name: 'Botijão P13' };
    const address = {
      street: 'Rua das Flores',
      number: '120',
      neighborhood: 'Centro',
      city: 'Teresina',
      state: 'PI',
    };
    const asked: OrderState = {
      ...state,
      cycleId: 'ciclo-1',
      product: p13,
      quantity: 2,
      address,
      addresses: [address],
      lastOrder: { productId: 1, quantity: 1, paymentType: 'PIX', address },
      boughtProductIds: [1],
      pendingOrderStatus: { resumeStep: null, customer: {} },
    };
    const result = await handlers.confirmCpf?.(asked, choose('identity:owner-changed'), tools);
    expect(result).toEqual({
      state: { step: 'askName', customer: {}, cycleId: 'ciclo-1', product: p13, quantity: 2 },
      replies: [text(msg.askName)],
    });
    const names = tools.calls.map(call => call.name);
    expect(names).not.toContain('customerHistory');
    expect(names).not.toContain('markVerified');
    expect(names).not.toContain('requestHandoff');
    expect(tools.calls.filter(call => call.name === 'track').map(call => call.args[0])).toEqual([
      { name: 'identity_check', outcome: 'owner_changed' },
    ]);
  });

  it('respostas nunca repetem os dígitos digitados', async () => {
    const tools = createFakeTools(unverified);
    for (const typed of ['98765432100', '111.222.333-44', '987']) {
      const result = await handlers.confirmCpf?.(state, say(typed), tools);
      const body = JSON.stringify(result?.replies);
      expect(body).not.toContain('987');
      expect(body).not.toContain('111');
    }
  });

  it('acerto com consulta de status pendente responde o status', async () => {
    const tools = createFakeTools(unverified);
    const spy = vi.spyOn(tools, 'latestOrderStatus');
    const pending: OrderState = {
      ...state,
      pendingOrderStatus: { resumeStep: null, customer: {} },
    };
    const result = await handlers.confirmCpf?.(pending, say(VALID_CPF), tools);
    expect(spy).toHaveBeenCalledWith(1, expect.any(Date));
    expect(result?.state).toBeNull();
  });

  it('acerto com falha na consulta da oferta de repetir segue o fluxo normal', async () => {
    const tools = createFakeTools({
      ...unverified,
      customerHistory: async () => ({
        addresses: [],
        productIds: [],
        lastOrder: {
          productId: 1,
          quantity: 1,
          paymentType: 'PIX',
          address: {
            street: 'Rua das Flores',
            number: '120',
            neighborhood: 'Centro',
            city: 'Teresina',
            state: 'PI',
          },
        },
      }),
      quote: async () => {
        throw new ToolError(new Error('fora'));
      },
    });
    const result = await handlers.confirmCpf?.(state, say(VALID_CPF), tools);
    expect(tools.calls.map(call => call.name)).toContain('markVerified');
    expect(result?.state?.step).not.toBe('confirmCpf');
    expect(result?.state?.step).not.toBe('offerRepeat');
    expect(result?.replies[0]).toEqual(text(msg.welcomeBack('Maria da Silva')));
  });
});

describe('askCpfPrefix (estado gravado antes do deploy)', () => {
  it('reinicia a identificação pedindo o CPF completo', async () => {
    const tools = createFakeTools(unverified);
    const old = {
      step: 'askCpfPrefix',
      customer: { id: 1, name: 'Maria da Silva', tagId: null },
    } as unknown as OrderState;
    const result = await handlers.askCpfPrefix?.(old, say('123'), tools);
    expect(result).toEqual({
      state: { step: 'confirmCpf', customer: {} },
      replies: [text(msg.askFullCpf)],
    });
    expect(tools.calls.map(call => call.name)).not.toContain('markVerified');
  });
});

describe('produto oferecido na primeira mensagem', () => {
  const p13 = { id: 1, name: 'Botijão P13' };
  const p45 = { id: 2, name: 'Botijão P45' };

  it('start de cliente cadastrado reconfere o produto com o cliente identificado', async () => {
    const tools = createFakeTools({ listProducts: async () => [p45] });
    const spy = vi.spyOn(tools, 'listProducts');
    const result = await start(say('oi'), tools, { product: p13, quantity: 2 });
    expect(spy).toHaveBeenCalledWith({ id: 1, tagId: null });
    expect(result.state?.product).toBeUndefined();
    expect(result.state?.quantity).toBeUndefined();
  });

  it('confirmCpf concluído reconfere o produto com o cliente identificado', async () => {
    const tools = createFakeTools({
      ...unverified,
      findCustomers: async () => [{ id: 7, name: 'Joana Lima', cpf: '12345678909', tagId: 3 }],
      listProducts: async () => [p45],
    });
    const spy = vi.spyOn(tools, 'listProducts');
    const state: OrderState = { step: 'confirmCpf', customer: {}, product: p13, quantity: 2 };
    const result = await handlers.confirmCpf?.(state, say(VALID_CPF), tools);
    expect(spy).toHaveBeenCalledWith({ id: 7, tagId: 3 });
    expect(result?.state?.product).toBeUndefined();
  });
});
