export function completion(
  content: string | null,
  overrides: { finishReason?: string; model?: string; usage?: object } = {},
) {
  return {
    model: overrides.model ?? 'gemini-test',
    choices: [
      { message: { role: 'assistant', content }, finish_reason: overrides.finishReason ?? 'stop' },
    ],
    usage: overrides.usage ?? { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
  };
}

export function providerError(status: number, message: string) {
  return { status, body: { error: { message, code: status } } };
}
