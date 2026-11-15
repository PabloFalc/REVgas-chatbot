import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { FLOW_ROUTES, type FlowRoute } from '../../conversation/contracts/flow-route';

export const EVAL_GROUPS = [
  'answerable',
  'unknown',
  'off_topic',
  'manipulation',
  'emergency',
  'price',
  'routing',
] as const;

export type EvalGroup = (typeof EVAL_GROUPS)[number];

const forbiddenSchema = z.array(z.string().min(1)).optional();

const answerableQuestionSchema = z.object({
  id: z.string().min(1),
  group: z.literal('answerable'),
  question: z.string().min(1),
  section: z.string().min(1),
  fact: z.string().min(1),
  forbidden: forbiddenSchema,
});

const priceQuestionSchema = z.object({
  id: z.string().min(1),
  group: z.literal('price'),
  question: z.string().min(1),
  expectedIntent: z.enum(['price', 'order']).optional(),
  forbidden: forbiddenSchema,
});

const routeSchema = z.enum(FLOW_ROUTES);

const routingQuestionSchema = z
  .object({
    id: z.string().min(1),
    group: z.literal('routing'),
    question: z.string().min(1),
    expectedRoute: routeSchema.optional(),
    forbiddenRoutes: z.array(routeSchema).min(1).optional(),
    forbidden: forbiddenSchema,
  })
  .refine(q => q.expectedRoute !== undefined || q.forbiddenRoutes !== undefined, {
    message: 'routing precisa de expectedRoute ou forbiddenRoutes',
  });

const otherQuestionSchema = z.object({
  id: z.string().min(1),
  group: z.enum(['unknown', 'off_topic', 'manipulation', 'emergency']),
  question: z.string().min(1),
  forbidden: forbiddenSchema,
});

export const evalQuestionSchema = z.union([
  answerableQuestionSchema,
  priceQuestionSchema,
  routingQuestionSchema,
  otherQuestionSchema,
]);

export const evalFileSchema = z.object({
  version: z.literal(1),
  questions: z.array(evalQuestionSchema),
});

export type EvalQuestion = z.infer<typeof evalQuestionSchema>;

export type RoutingQuestion = z.infer<typeof routingQuestionSchema>;

export function routeMatches(question: RoutingQuestion, route: FlowRoute): boolean {
  if (question.expectedRoute !== undefined && route !== question.expectedRoute) return false;
  return !(question.forbiddenRoutes ?? []).includes(route);
}

export type ExpectedIntent = 'price' | 'order';

export function expectedIntentOf(question: EvalQuestion): ExpectedIntent {
  return question.group === 'price' ? (question.expectedIntent ?? 'price') : 'price';
}

export async function loadEvalQuestions(path: string): Promise<EvalQuestion[]> {
  const raw = await readFile(path, 'utf8');
  return evalFileSchema.parse(JSON.parse(raw)).questions;
}
