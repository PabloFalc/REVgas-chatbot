import { AppError } from './base-app.error';

export class ThrottlerError extends AppError {
  constructor(public readonly retryAfter: number) {
    const message = `Limite de requisições excedido, tente novamente em ${retryAfter} segundos`;
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}
