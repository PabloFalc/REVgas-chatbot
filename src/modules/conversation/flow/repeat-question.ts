import type { Reply } from '../contracts/conversation.types';
import type { FlowTools, OrderState, StepResult } from './flow.types';
import { asks } from './steps/registry';

export async function repeatQuestion(
  state: OrderState,
  tools: FlowTools,
  first: Reply,
): Promise<StepResult> {
  const ask = asks[state.step];
  if (!ask) return { state, replies: [first] };
  const asked = await ask(state, tools);
  return { state: asked.state, replies: [first, ...asked.replies] };
}
