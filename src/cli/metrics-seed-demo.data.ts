import type { Step } from '../modules/conversation/flow/flow.types';
import type { HandoffReason, HandoffStatus } from '../modules/handoff/contracts/handoff.types';
import type { MetricEvent } from '../modules/metrics/contracts/metrics.types';
import type {
  CustomerSegment,
  SaleAttemptErrorKind,
  SaleAttemptInput,
  SaleAttemptStatus,
} from '../modules/order/contracts/order.types';

export const DEMO_DAYS = 14;
export const DEMO_SEED = 20260601;

const ID_PREFIX = '0de00de0-0000-4000-8000-';
export const DEMO_ID_MIN = `${ID_PREFIX}000000000000`;
export const DEMO_ID_MAX = `${ID_PREFIX}ffffffffffff`;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DEMO_CUSTOMER_ID = 0;
const PRODUCT = { code: '900000101', unitCents: 12_500 };

export interface DemoBotEvent {
  event: MetricEvent;
  occurredAt: Date;
}

export interface DemoSaleAttempt extends SaleAttemptInput {
  status: Exclude<SaleAttemptStatus, 'pending'>;
  errorKind: SaleAttemptErrorKind | null;
  createdAt: Date;
}

export interface DemoData {
  events: DemoBotEvent[];
  sales: DemoSaleAttempt[];
}

type CycleKind =
  | 'greeting'
  | 'early'
  | 'handoffOnly'
  | 'abandoned'
  | 'cancelled'
  | 'sold'
  | 'failed'
  | 'rejected'
  | 'uncertain';

type Rng = ReturnType<typeof createRng>;

function createRng(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const chance = (p: number): boolean => next() < p;
  const pick = <T>(options: ReadonlyArray<readonly [T, number]>): T => {
    const total = options.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = next() * total;
    for (const [value, weight] of options) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return options[options.length - 1][0];
  };
  const logNormal = (median: number, sigma: number): number => {
    const normal = Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
    return Math.max(1, Math.round(median * Math.exp(sigma * normal)));
  };
  return { next, int, chance, pick, logNormal };
}

const demoId = (n: number): string => `${ID_PREFIX}${n.toString(16).padStart(12, '0')}`;

const NEW_PATH: Step[] = [
  'askName',
  'askCpf',
  'askNewAddress',
  'askAddressField',
  'confirmAddress',
  'chooseProduct',
  'chooseQuantity',
  'choosePayment',
];
const RECURRING_PATH: Step[] = [
  'confirmCpf',
  'chooseAddress',
  'chooseProduct',
  'chooseQuantity',
  'choosePayment',
];

const KIND_WEIGHTS: ReadonlyArray<readonly [CycleKind, number]> = [
  ['greeting', 0.12],
  ['early', 0.16],
  ['handoffOnly', 0.07],
  ['abandoned', 0.17],
  ['cancelled', 0.05],
  ['sold', 0.38],
  ['failed', 0.02],
  ['rejected', 0.015],
  ['uncertain', 0.015],
];

const WEEKDAY_FACTOR = [0.7, 1.0, 0.95, 1.0, 1.05, 1.2, 1.3];

interface DayContext {
  latencyMedianMs: number;
  waitMedianMs: number;
  ragUnknownRate: number;
  windowStart: number;
  windowEnd: number;
}

interface Builder {
  rng: Rng;
  day: DayContext;
  nextId: () => string;
  now: number;
  events: DemoBotEvent[];
  sales: DemoSaleAttempt[];
}

function dayWindow(now: number, daysAgo: number): { start: number; end: number } {
  const midnight = now - (now % DAY);
  if (daysAgo > 0) {
    const start = midnight - daysAgo * DAY + 10 * HOUR;
    return { start, end: start + 10 * HOUR };
  }
  return { start: Math.min(midnight + 10 * HOUR, now - 6 * HOUR), end: now - 20 * 60_000 };
}

export function generateDemoData(
  now: Date,
  options: { days?: number; seed?: number } = {},
): DemoData {
  const days = options.days ?? DEMO_DAYS;
  const rng = createRng(options.seed ?? DEMO_SEED);
  let counter = 0;
  const nextId = () => demoId(++counter);
  const data: DemoData = { events: [], sales: [] };

  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    const { start, end } = dayWindow(now.getTime(), daysAgo);
    const weekday = new Date(start).getUTCDay();
    const share = Math.min(1, Math.max(0.3, (end - start) / (10 * HOUR)));
    const cycles = Math.round(45 * WEEKDAY_FACTOR[weekday] * (0.8 + 0.4 * rng.next()) * share);
    const day: DayContext = {
      latencyMedianMs: 300 + Math.round(rng.next() * 500),
      waitMedianMs: 45_000 + Math.round(rng.next() * 150_000),
      ragUnknownRate: 0.15 + rng.next() * 0.2,
      windowStart: start,
      windowEnd: end,
    };
    for (let i = 0; i < cycles; i++) {
      const builder: Builder = {
        rng,
        day,
        nextId,
        now: now.getTime(),
        events: [],
        sales: [],
      };
      buildCycle(builder, rng.pick(KIND_WEIGHTS));
      data.events.push(...builder.events);
      data.sales.push(...builder.sales);
    }
  }
  return data;
}

function buildCycle(b: Builder, kind: CycleKind): void {
  const { rng, day } = b;
  const cycleId = b.nextId();
  const segment: CustomerSegment = rng.pick([
    ['recurring', 0.45],
    ['new', 0.4],
    ['unknown', 0.15],
  ] as const);
  const payment = rng.pick([
    ['PIX', 0.45],
    ['MONEY', 0.35],
    ['VISA', 0.1],
    ['MASTER', 0.1],
  ] as const);
  const fullPath = [...(segment === 'new' ? NEW_PATH : RECURRING_PATH)];
  if (payment === 'MONEY') fullPath.push('askNeedsChange');
  fullPath.push('summary');
  const chooseProductIndex = fullPath.indexOf('chooseProduct');

  const cycleEvents: DemoBotEvent[] = [];
  const emit = (at: number, event: MetricEvent) =>
    cycleEvents.push({ event: { ...event, cycleId }, occurredAt: new Date(at) });

  let path: Step[];
  if (kind === 'greeting') path = fullPath.slice(0, 1);
  else if (kind === 'early' || kind === 'handoffOnly') {
    path = fullPath.slice(0, rng.int(2, chooseProductIndex));
  } else if (kind === 'abandoned') {
    const stopAt = rng.pick([
      ['chooseProduct', 0.2],
      ['chooseQuantity', 0.3],
      ['choosePayment', 0.25],
      ['summary', 0.25],
    ] as const);
    path = fullPath.slice(0, fullPath.indexOf(stopAt) + 1);
  } else path = fullPath;

  let at = day.windowStart + Math.floor(rng.next() * (day.windowEnd - day.windowStart));
  let ragDone = false;
  path.forEach((step, index) => {
    at += rng.logNormal(25_000, 0.6);
    if (step === 'chooseProduct') {
      emit(at - 1, { name: 'purchase_started', reason: segment });
    }
    const aiReason =
      step === 'askName'
        ? rng.chance(0.6) && 'read_name'
        : step === 'askNewAddress' || step === 'askAddressField'
          ? rng.chance(0.5) && 'address'
          : rng.chance(0.08) && 'interpret';
    if (aiReason) emitAiCall(b, emit, at - rng.int(50, 500), aiReason);
    if (
      index > 0 &&
      index < path.length - 1 &&
      !ragDone &&
      rng.chance(0.2) &&
      kind !== 'greeting'
    ) {
      ragDone = true;
      emitAiCall(b, emit, at - 700, 'question');
      emitRag(b, emit, at - 300);
    }
    emit(at, {
      name: 'turn',
      prevStep: index > 0 ? path[index - 1] : undefined,
      step,
      durationMs: turnDuration(b),
    });
  });

  const lastStep = path[path.length - 1];
  const handoff = (reason: HandoffReason, since: number) => emitHandoff(b, emit, reason, since);

  if (kind === 'early' && rng.chance(0.15)) {
    emit(at + 1_000, {
      name: 'handoff_offered',
      reason: rng.pick([
        ['stuck', 0.7],
        ['offense', 0.3],
      ] as const),
    });
  }
  if (kind === 'early' && rng.chance(0.12)) handoff('customer_request', at + 5_000);
  if (kind === 'greeting' && rng.chance(0.08)) handoff('customer_request', at + 5_000);
  if (kind === 'handoffOnly') {
    const reason = rng.pick([
      ['customer_request', 0.5],
      ['identity_failure', 0.2],
      ['quantity_limit', 0.2],
      ['emergency', 0.1],
    ] as const);
    if (reason === 'quantity_limit') {
      emit(at + 2_000, {
        name: 'quantity_limit',
        reason: rng.pick([
          ['max', 0.6],
          ['stock', 0.4],
        ] as const),
      });
    }
    if (reason === 'emergency') emit(at + 2_000, { name: 'emergency', reason: 'agent_route' });
    handoff(reason, at + 5_000);
  }
  if (kind === 'cancelled') emit(at + rng.logNormal(20_000, 0.5), { name: 'order_cancelled' });

  if (kind === 'sold' || kind === 'failed' || kind === 'rejected' || kind === 'uncertain') {
    const saleAt = at + rng.logNormal(15_000, 0.5);
    const quantity = rng.pick([
      [1, 0.7],
      [2, 0.2],
      [3, 0.1],
    ] as const);
    const attempt = {
      cycleId,
      customerId: DEMO_CUSTOMER_ID,
      totalCents: PRODUCT.unitCents * quantity,
      productCode: PRODUCT.code,
      paymentMethodCode: payment,
      customerSegment: segment,
      isSimulated: true as const,
      createdAt: new Date(saleAt),
    };
    if (kind === 'sold') {
      emit(saleAt, {
        name: 'sale',
        outcome: 'created',
        reason: rng.chance(0.04) ? 'recovered' : 'direct',
      });
      emit(saleAt + 50, { name: 'turn', prevStep: lastStep, durationMs: turnDuration(b) });
      b.sales.push({ ...attempt, status: 'registered', errorKind: null });
      if (rng.chance(0.04)) handoff('sale_cancellation', saleAt + 120_000);
    } else if (kind === 'failed') {
      emit(saleAt, { name: 'sale', outcome: 'failed', reason: 'unavailable' });
      b.sales.push({ ...attempt, status: 'failed', errorKind: 'server_error' });
      handoff('sale_failed', saleAt + 1_000);
    } else if (kind === 'rejected') {
      emit(saleAt, { name: 'sale', outcome: 'rejected', reason: 'unexpected' });
      b.sales.push({ ...attempt, status: 'rejected', errorKind: 'validation' });
      handoff('sale_rejected', saleAt + 1_000);
    } else {
      emit(saleAt, { name: 'sale', outcome: 'failed', reason: 'unknown_outcome' });
      emit(saleAt + 10, { name: 'sale_outcome_unknown', reason: 'timeout', isSimulated: true });
      b.sales.push({ ...attempt, status: 'uncertain', errorKind: 'timeout' });
      handoff('sale_uncertain', saleAt + 1_000);
    }
  }

  const latest = Math.max(...cycleEvents.map(item => item.occurredAt.getTime()));
  const limit = b.now - 60_000;
  const shift = latest > limit ? latest - limit : 0;
  for (const item of cycleEvents) {
    b.events.push({ ...item, occurredAt: new Date(item.occurredAt.getTime() - shift) });
  }
  for (const sale of b.sales) {
    if (sale.cycleId === cycleId) sale.createdAt = new Date(sale.createdAt.getTime() - shift);
  }
}

type Emit = (at: number, event: MetricEvent) => void;

function turnDuration(b: Builder): number {
  const base = b.rng.logNormal(b.day.latencyMedianMs, 0.5);
  return b.rng.chance(0.06) ? base * 4 : base;
}

function emitAiCall(
  b: Builder,
  emit: Emit,
  at: number,
  reason: 'interpret' | 'read_name' | 'address' | 'question',
): void {
  emit(at, {
    name: 'ai_call',
    outcome: b.rng.chance(0.06) ? 'limited' : 'allowed',
    reason,
    amount: b.rng.pick([
      [1, 0.7],
      [2, 0.3],
    ] as const),
  });
}

function emitRag(b: Builder, emit: Emit, at: number): void {
  const unknown = b.rng.chance(b.day.ragUnknownRate);
  emit(at, {
    name: 'rag',
    outcome: unknown ? 'unknown' : 'answered',
    reason: unknown
      ? b.rng.pick([
          ['no_match', 0.4],
          ['not_in_sources', 0.35],
          ['rejected', 0.1],
          ['unavailable', 0.15],
        ] as const)
      : undefined,
    durationMs: b.rng.logNormal(1_200, 0.5),
  });
}

function emitHandoff(b: Builder, emit: Emit, reason: HandoffReason, since: number): void {
  const { rng } = b;
  const status: HandoffStatus = rng.pick([
    ['queued', 0.78],
    ['alreadyQueued', 0.06],
    ['active', 0.06],
    ['unavailable', 0.1],
  ] as const);
  emit(since, { name: 'handoff', outcome: status, reason });
  if (status === 'unavailable' || status === 'active') return;
  const handoffId = b.nextId();
  if (rng.chance(0.88)) {
    const wait = rng.logNormal(b.day.waitMedianMs, 0.9);
    const assumedAt = since + wait;
    emit(assumedAt, { name: 'handoff_assumed', handoffId, durationMs: wait });
    if (rng.chance(0.85)) {
      const service = rng.logNormal(8 * 60_000, 0.6);
      emit(assumedAt + service, { name: 'handoff_resolved', handoffId, durationMs: service });
    }
  } else {
    const expiry = rng.int(15, 30) * 60_000;
    emit(since + expiry, { name: 'handoff_expired', handoffId, durationMs: expiry });
  }
}
