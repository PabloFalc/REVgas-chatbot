import {
  DEMO_DAYS,
  DEMO_ID_MAX,
  DEMO_ID_MIN,
  type DemoBotEvent,
  generateDemoData,
} from './metrics-seed-demo.data';

const NOW = new Date('2026-11-28T15:00:00Z');
const DAY = 86_400_000;
const day = (item: DemoBotEvent) => item.occurredAt.toISOString().slice(0, 10);

describe('generateDemoData', () => {
  const data = generateDemoData(NOW);

  it('é determinístico', () => {
    expect(generateDemoData(NOW)).toEqual(data);
  });

  it('marca tudo como simulado e identificável pelo intervalo de ids', () => {
    expect(data.sales.length).toBeGreaterThan(0);
    for (const sale of data.sales) {
      expect(sale.isSimulated).toBe(true);
      expect(sale.cycleId >= DEMO_ID_MIN && sale.cycleId <= DEMO_ID_MAX).toBe(true);
    }
    for (const { event } of data.events) {
      expect(event.cycleId && event.cycleId >= DEMO_ID_MIN && event.cycleId <= DEMO_ID_MAX).toBe(
        true,
      );
      if ('isSimulated' in event) expect(event.isSimulated).toBe(true);
    }
  });

  it('mantém datas dentro da janela e nunca no futuro', () => {
    const times = [...data.events.map(e => e.occurredAt), ...data.sales.map(s => s.createdAt)].map(
      date => date.getTime(),
    );
    expect(Math.max(...times)).toBeLessThanOrEqual(NOW.getTime());
    expect(Math.min(...times)).toBeGreaterThanOrEqual(NOW.getTime() - DEMO_DAYS * DAY);
    expect(new Set(data.events.map(day)).size).toBe(DEMO_DAYS);
  });

  it('gera funil decrescente em cada dia, com volume diferente entre dias', () => {
    const byCycle = new Map<
      string,
      { day: string; started: boolean; summary: boolean; sold: boolean }
    >();
    for (const item of [...data.events].sort((a, b) => +a.occurredAt - +b.occurredAt)) {
      const { event } = item;
      const cycle = byCycle.get(event.cycleId as string) ?? {
        day: day(item),
        started: false,
        summary: false,
        sold: false,
      };
      if (event.name === 'turn' && event.step) cycle.started = true;
      if (event.name === 'turn' && event.step === 'summary') cycle.summary = true;
      if (event.name === 'sale' && event.outcome === 'created') cycle.sold = true;
      byCycle.set(event.cycleId as string, cycle);
    }
    const perDay = new Map<string, number[]>();
    for (const cycle of byCycle.values()) {
      const row = perDay.get(cycle.day) ?? [0, 0, 0];
      if (cycle.started) row[0]++;
      if (cycle.started && cycle.summary) row[1]++;
      if (cycle.started && cycle.sold) row[2]++;
      perDay.set(cycle.day, row);
    }
    expect(perDay.size).toBe(DEMO_DAYS);
    for (const [ciclos, resumos, vendas] of perDay.values()) {
      expect(ciclos).toBeGreaterThan(resumos);
      expect(resumos).toBeGreaterThan(vendas);
      expect(vendas).toBeGreaterThan(0);
    }
    expect(new Set([...perDay.values()].map(row => row[0])).size).toBeGreaterThan(5);
  });

  it('cobre os eventos e estados que alimentam os cards', () => {
    const names = (name: string) => data.events.filter(item => item.event.name === name);
    const reasons = (name: string) =>
      new Set(names(name).map(item => (item.event as { reason?: string }).reason));
    expect(new Set(data.sales.map(sale => sale.status))).toEqual(
      new Set(['registered', 'failed', 'rejected', 'uncertain']),
    );
    expect(reasons('handoff').size).toBeGreaterThanOrEqual(5);
    expect(reasons('handoff_offered').size).toBe(2);
    expect(names('handoff_assumed').length).toBeGreaterThan(10);
    expect(reasons('rag')).toContain('no_match');
    expect(
      names('rag').some(item => (item.event as { outcome: string }).outcome === 'answered'),
    ).toBe(true);
    const outcomes = new Set(
      names('ai_call').map(item => (item.event as { outcome: string }).outcome),
    );
    expect(outcomes).toEqual(new Set(['allowed', 'limited']));
    const sold = new Set(data.sales.filter(s => s.status === 'registered').map(s => s.cycleId));
    const started = names('purchase_started').filter(
      item => item.occurredAt.getTime() < NOW.getTime() - 2 * DAY,
    );
    expect(started.some(item => !sold.has(item.event.cycleId as string))).toBe(true);
    expect(started.some(item => sold.has(item.event.cycleId as string))).toBe(true);
  });

  it('usa um cliente fictício nas vendas', () => {
    for (const sale of data.sales) expect(sale.customerId).toBe(0);
  });
});
