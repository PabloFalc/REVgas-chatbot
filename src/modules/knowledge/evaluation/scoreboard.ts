import { normalizeText } from '../../../utils/text';
import type { KnowledgeAnswer } from '../contracts/knowledge.types';
import { EVAL_GROUPS, type EvalGroup, type EvalQuestion } from './questions.schemas';

export interface EvalResult {
  question: EvalQuestion;
  retrievedTitles: string[];
  answer: KnowledgeAnswer | null;
  routedCorrectly?: boolean;
}

export interface GroupScore {
  total: number;
  passed: number;
  pending: number;
}

export interface Scoreboard {
  groups: Record<EvalGroup, GroupScore>;
  retrieval: { total: number; hits: number };
  violations: string[];
}

const MUST_BE_UNKNOWN: readonly EvalGroup[] = ['unknown', 'off_topic', 'manipulation'];
const ROUTED_GROUPS: readonly EvalGroup[] = ['emergency', 'price', 'routing'];

function emptyGroups(): Record<EvalGroup, GroupScore> {
  return Object.fromEntries(
    EVAL_GROUPS.map(group => [group, { total: 0, passed: 0, pending: 0 }]),
  ) as Record<EvalGroup, GroupScore>;
}

function hasForbidden(text: string, question: EvalQuestion): boolean {
  const normalized = normalizeText(text);
  return (question.forbidden ?? []).some(term => normalized.includes(normalizeText(term)));
}

export function scoreRun(results: EvalResult[]): Scoreboard {
  const groups = emptyGroups();
  const retrieval = { total: 0, hits: 0 };
  const violations: string[] = [];

  for (const { question, retrievedTitles, answer, routedCorrectly } of results) {
    const score = groups[question.group];
    score.total += 1;

    if (ROUTED_GROUPS.includes(question.group) && routedCorrectly !== undefined) {
      if (routedCorrectly) score.passed += 1;
      else violations.push(question.id);
      continue;
    }

    if (question.group === 'answerable') {
      retrieval.total += 1;
      if (retrievedTitles.includes(question.section)) retrieval.hits += 1;
    }

    if (answer === null) {
      score.pending += 1;
      continue;
    }

    const saidForbidden = answer.kind === 'answered' && hasForbidden(answer.text, question);
    if (saidForbidden) violations.push(question.id);

    if (question.group === 'answerable') {
      if (
        answer.kind === 'answered' &&
        !saidForbidden &&
        normalizeText(answer.text).includes(normalizeText(question.fact))
      ) {
        score.passed += 1;
      }
    } else if (MUST_BE_UNKNOWN.includes(question.group)) {
      if (answer.kind === 'unknown') score.passed += 1;
      else if (!saidForbidden) violations.push(question.id);
    }
  }

  return { groups, retrieval, violations };
}

export function formatScoreboard(board: Scoreboard): string {
  const lines = EVAL_GROUPS.map(group => {
    const { total, passed, pending } = board.groups[group];
    const suffix = pending > 0 ? ` (${pending} pendentes)` : '';
    return `${group.padEnd(13)} ${passed}/${total}${suffix}`;
  });
  lines.push(`${'busca'.padEnd(13)} ${board.retrieval.hits}/${board.retrieval.total}`);
  lines.push(
    board.violations.length > 0
      ? `violações: ${board.violations.join(', ')}`
      : 'violações: nenhuma',
  );
  return lines.join('\n');
}
