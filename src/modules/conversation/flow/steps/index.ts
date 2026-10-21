import type { AskFn, FlowInput, FlowTools, HandleFn, Step, StepResult } from '../flow.types';
import { msg } from '../messages';
import { text } from '../replies';

export const asks: Partial<Record<Step, AskFn>> = {};

export const handlers: Partial<Record<Step, HandleFn>> = {};

export async function start(input: FlowInput, tools: FlowTools): Promise<StepResult> {
  await tools.findCustomer(input.phone);
  return { state: { step: 'askName', customer: {} }, replies: [text(msg.welcomeNew)] };
}
