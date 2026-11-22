import type { FlowInput } from './flow.types';

export function textOf(input: FlowInput): string | null {
  return input.content.type === 'text' ? input.content.text : null;
}

export function choiceOf(input: FlowInput, prefix: string): string | null {
  if (input.content.type !== 'choice') return null;
  const head = `${prefix}:`;
  return input.content.id.startsWith(head) ? input.content.id.slice(head.length) : null;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
