import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import type { FlowRoute } from '../contracts/flow-route';
import { detectEmergency } from './emergency';
import { MIN_CONFIDENCE } from './free-text';
import { asksForAgent } from './handoff';
import { intentRoute } from './intent';
import { isQuestionInvite } from './question-invite';

export async function routeOfText(
  raw: string,
  interpret: () => Promise<Interpretation | null>,
): Promise<FlowRoute> {
  if (detectEmergency(raw)) return 'emergency';
  if (asksForAgent(raw)) return 'transfer';
  if (isQuestionInvite(raw)) return 'invite';
  const result = await interpret();
  if (!result || result.confidence < MIN_CONFIDENCE) return 'not_understood';
  return intentRoute(result);
}
