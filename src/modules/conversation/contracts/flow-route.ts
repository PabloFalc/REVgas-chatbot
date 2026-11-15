export const FLOW_ROUTES = [
  'emergency',
  'transfer',
  'invite',
  'offer_agent',
  'delivery_fee',
  'price',
  'hours',
  'payments',
  'knowledge',
  'off_topic',
  'offense',
  'order',
  'not_understood',
] as const;

export type FlowRoute = (typeof FLOW_ROUTES)[number];
