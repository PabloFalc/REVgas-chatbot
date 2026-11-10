import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const EVAL_GROUPS = [
  'answerable',
  'unknown',
  'off_topic',
  'manipulation',
  'emergency',
  'price',
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

const otherQuestionSchema = z.object({
  id: z.string().min(1),
  group: z.enum(['unknown', 'off_topic', 'manipulation', 'emergency', 'price']),
  question: z.string().min(1),
  forbidden: forbiddenSchema,
});

export const evalQuestionSchema = z.union([answerableQuestionSchema, otherQuestionSchema]);

export const evalFileSchema = z.object({
  version: z.literal(1),
  questions: z.array(evalQuestionSchema),
});

export type EvalQuestion = z.infer<typeof evalQuestionSchema>;

export async function loadEvalQuestions(path: string): Promise<EvalQuestion[]> {
  const raw = await readFile(path, 'utf8');
  return evalFileSchema.parse(JSON.parse(raw)).questions;
}
