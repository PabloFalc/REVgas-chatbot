import {
  type FlowInput,
  type FlowTools,
  type OrderState,
  type StepResult,
  ToolError,
} from './flow.types';
import { globalCommand } from './global-commands';
import { msg } from './messages';
import { text } from './replies';
import { handlers, start } from './steps';

export { ToolError };

function wrapTools(tools: FlowTools): FlowTools {
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tools)) {
    if (key === 'now' || typeof value !== 'function') {
      wrapped[key] = value;
      continue;
    }
    wrapped[key] = async (...args: unknown[]) => {
      try {
        return await value.apply(tools, args);
      } catch (error) {
        throw new ToolError(error);
      }
    };
  }
  return wrapped as unknown as FlowTools;
}

export async function runFlow(
  state: OrderState | null,
  input: FlowInput,
  tools: FlowTools,
  onToolError?: (error: ToolError) => void,
): Promise<StepResult> {
  const safe = wrapTools(tools);
  try {
    const global = await globalCommand(state, input, safe);
    if (global) return global;
    const handle = state ? handlers[state.step] : undefined;
    if (!state || !handle) return await start(input, safe);
    return await handle(state, input, safe);
  } catch (error) {
    if (error instanceof ToolError) {
      onToolError?.(error);
      return { state, replies: [text(msg.unavailable)] };
    }
    throw error;
  }
}
