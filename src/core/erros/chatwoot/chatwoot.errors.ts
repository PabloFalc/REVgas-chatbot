export type ChatwootErrorKind =
  | 'unauthorized'
  | 'not_found'
  | 'rejected'
  | 'unavailable'
  | 'response'
  | 'unknown_outcome';

export class ChatwootError extends Error {
  readonly kind: ChatwootErrorKind;
  readonly status?: number;

  constructor(kind: ChatwootErrorKind, message: string, status?: number) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.status = status;
  }
}

export function mapChatwootError(status: number): ChatwootError {
  const message = `Chatwoot respondeu ${status}`;
  if (status === 401 || status === 403) {
    return new ChatwootError('unauthorized', message, status);
  }
  if (status === 404) {
    return new ChatwootError('not_found', message, status);
  }
  if (status >= 500) {
    return new ChatwootError('unavailable', message, status);
  }
  return new ChatwootError('rejected', message, status);
}
