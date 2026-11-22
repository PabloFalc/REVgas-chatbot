import {
  type FlowInput,
  type FlowTools,
  type OrderState,
  type StepResult,
  ToolError,
} from './flow.types';
import { readFirstMessage } from './free-text';
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

async function route(
  state: OrderState | null,
  input: FlowInput,
  tools: FlowTools,
): Promise<StepResult> {
  const global = await globalCommand(state, input, tools);
  if (global) return global;
  const handle = state ? handlers[state.step] : undefined;
  if (state && handle) return handle(state, input, tools);
  const raw = state ? null : textOf(input);
  const first = raw === null ? null : await readFirstMessage(raw, tools);
  if (first?.kind === 'routed') return first.result;
  const seed = first?.seed ?? { fields: {}, replies: [] };
  const started = await start(input, tools, seed.fields);
  const [greeting, ...rest] = started.replies;
  const replies = greeting ? [greeting, ...seed.replies, ...rest] : seed.replies;
  return { ...started, replies };
}

async function resetMisunderstood(tools: FlowTools): Promise<void> {
  try {
    await tools.resetMisunderstood();
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
  }
}

export async function runFlow(
  state: OrderState | null,
  input: FlowInput,
  tools: FlowTools,
  onToolError?: (error: ToolError) => void,
): Promise<StepResult> {
  const safe = wrapTools(tools);
  try {
    const result = await route(state, input, safe);
    const fromCustomer = input.content.type === 'text' || input.content.type === 'choice';
    if (fromCustomer && !result.misunderstood) await resetMisunderstood(safe);
    return result;
  } catch (error) {
    if (error instanceof ToolError) {
      onToolError?.(error);
      return { state, replies: [text(msg.unavailable)] };
    }
    throw error;
  }
}
