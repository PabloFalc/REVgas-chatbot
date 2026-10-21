import type { FlowInput, FlowTools, OrderState, StepResult } from './flow.types';
import { globalCommand } from './global-commands';
import { msg } from './messages';
import { handlers, start } from './steps';

export async function runFlow(
  state: OrderState | null,
  input: FlowInput,
  tools: FlowTools,
): Promise<StepResult> {
  try {
    const global = await globalCommand(state, input, tools);
    if (global) return global;
    if (!state) return await start(input, tools);
    const handle = handlers[state.step];
    if (!handle) return { state, replies: [] };
    return await handle(state, input, tools);
  } catch {
    return { state, replies: [msg.unavailable] };
  }
}
