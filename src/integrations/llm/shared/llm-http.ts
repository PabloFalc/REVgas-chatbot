import { isTimeoutError } from '../../../utils/guards';
import { parseJsonOrText } from '../../../utils/parse-json';

export type HttpOutcome =
  | { kind: 'response'; ok: boolean; status: number; body: unknown }
  | { kind: 'failure'; timedOut: boolean };

export type PostJsonParams = {
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  fetch: typeof fetch;
};

export async function postJson(params: PostJsonParams): Promise<HttpOutcome> {
  try {
    const response = await params.fetch(params.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params.body),
      signal: AbortSignal.timeout(params.timeoutMs),
    });
    const parsed = parseJsonOrText(await response.text());
    return { kind: 'response', ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return { kind: 'failure', timedOut: isTimeoutError(error) };
  }
}
