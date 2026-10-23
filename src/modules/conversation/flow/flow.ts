import {
  type FlowInput,
  type FlowTools,
  type OrderState,
  type StepResult,
  ToolError,
} from './flow.types';
import { looksLikeOrder, type Seed, seedFromText } from './free-text';
import { globalCommand } from './global-commands';
import { textOf } from './input';
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
    if (state && handle) return await handle(state, input, safe);
    const raw = state ? null : textOf(input);
    const seed: Seed =
      raw !== null && looksLikeOrder(raw)
        ? await seedFromText(raw, safe)
        : { fields: {}, replies: [] };
    const started = await start(input, safe, seed.fields);
    const [greeting, ...rest] = started.replies;
    const replies = greeting ? [greeting, ...seed.replies, ...rest] : seed.replies;
    return { ...started, replies };
  } catch (error) {
    if (error instanceof ToolError) {
      onToolError?.(error);
      return { state, replies: [text(msg.unavailable)] };
    }
    throw error;
  }
}
