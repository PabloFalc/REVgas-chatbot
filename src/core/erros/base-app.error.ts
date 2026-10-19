export class AppError extends Error {
  public readonly timestamp: string;

  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'APP_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);

    this.name = new.target.name;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace?.(this, new.target);
  }
}

export type ErrorParams = {
  message?: string;
  details?: unknown;
};
