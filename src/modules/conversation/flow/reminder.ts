import type { FlowTools, OrderState, StepResult } from './flow.types';
import { msg } from './messages';
import { repeatQuestion } from './repeat-question';
import { text } from './replies';
import './steps';

export const REMINDER_AFTER_MS = 600_000;

export async function reminderFor(state: OrderState, tools: FlowTools): Promise<StepResult | null> {
  const { lastInboundAt } = state;
  if (state.step === 'creatingSale' || !lastInboundAt) return null;
  if (state.remindedFor === lastInboundAt) return null;
  if (tools.now().getTime() - new Date(lastInboundAt).getTime() < REMINDER_AFTER_MS) return null;
  const result = await repeatQuestion(state, tools, text(msg.reminder));
  return {
    ...result,
    state: result.state && { ...result.state, remindedFor: lastInboundAt },
  };
}
