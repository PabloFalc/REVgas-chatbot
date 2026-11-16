import { resolve } from 'node:path';
import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import {
  loadEvalQuestions,
  type RoutingQuestion,
  routeMatches,
} from 'src/modules/knowledge/evaluation/questions.schemas';
import { describe, expect, it, vi } from 'vitest';
import { intentRoute } from './intent';
import { routeOfText } from './route';

const reading = (partial: Partial<Interpretation>): Interpretation => ({
  intent: 'other',
  confidence: 0.9,
  ...partial,
});

describe('intentRoute', () => {
  it.each([
    [reading({ intent: 'question', topic: 'invite' }), 'invite'],
    [reading({ intent: 'question', topic: 'hours' }), 'hours'],
    [reading({ intent: 'question', topic: 'payments' }), 'payments'],
    [reading({ intent: 'question', topic: 'general' }), 'knowledge'],
    [reading({ intent: 'question' }), 'knowledge'],
    [reading({ intent: 'price' }), 'price'],
    [reading({ intent: 'price', topic: 'delivery_fee' }), 'delivery_fee'],
    [reading({ intent: 'handoff' }), 'offer_agent'],
    [reading({ intent: 'off_topic' }), 'off_topic'],
    [reading({ intent: 'offense' }), 'offense'],
    [reading({ intent: 'order' }), 'order'],
    [reading({ intent: 'other' }), 'not_understood'],
  ] as const)('%o → %s', (interpretation, route) => {
    expect(intentRoute(interpretation)).toBe(route);
  });
});

describe('routeOfText', () => {
  const never = () => {
    throw new Error('não devia chamar a IA');
  };

  it('emergência vem antes de tudo, sem IA', async () => {
    expect(await routeOfText('tá com cheiro de gás aqui', never)).toBe('emergency');
  });

  it('palavrão vira ofensa pelo código, sem IA, depois da emergência', async () => {
    expect(await routeOfText('vai te fuder', never)).toBe('offense');
    expect(await routeOfText('cheiro de gás, porra', never)).toBe('emergency');
  });

  it('"atendente" digitado transfere direto, sem IA', async () => {
    expect(await routeOfText('quero falar com um atendente', never)).toBe('transfer');
  });

  it('convite reconhecido pelo código não chama a IA', async () => {
    expect(await routeOfText('tenho dúvidas', never)).toBe('invite');
  });

  it('o resto usa a leitura da IA', async () => {
    const interpret = vi.fn(async () => reading({ intent: 'price', topic: 'delivery_fee' }));
    expect(await routeOfText('qual o valor da entrega?', interpret)).toBe('delivery_fee');
    expect(interpret).toHaveBeenCalledOnce();
  });

  it('pedido de atendente só pela IA vira oferta, nunca transferência', async () => {
    const route = await routeOfText('não quero tirar minhas dúvidas', async () =>
      reading({ intent: 'handoff' }),
    );
    expect(route).toBe('offer_agent');
  });

  it('IA fora do ar ou com pouca certeza não entende', async () => {
    expect(await routeOfText('blá', async () => null)).toBe('not_understood');
    expect(
      await routeOfText('blá', async () => reading({ intent: 'order', confidence: 0.5 })),
    ).toBe('not_understood');
  });
});

describe('casos routing do rag:check decididos sem IA', () => {
  it('o que o código decide sozinho já bate com o esperado', async () => {
    const questions = await loadEvalQuestions(
      resolve(process.cwd(), 'knowledge/evaluation/questions.json'),
    );
    const routing = questions.filter((q): q is RoutingQuestion => q.group === 'routing');
    expect(routing.length).toBeGreaterThan(0);
    for (const question of routing) {
      const route = await routeOfText(question.question, async () => null);
      if (route === 'not_understood') continue;
      expect({ id: question.id, ok: routeMatches(question, route) }).toEqual({
        id: question.id,
        ok: true,
      });
    }
  });
});
