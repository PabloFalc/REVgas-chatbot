import { AppError, type ErrorParams } from './base-app.error';

export class BadRequestError extends AppError {
  constructor(params?: ErrorParams) {
    super(params?.message ?? 'Requisição inválida', 400, 'BAD_REQUEST', params?.details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(params?: ErrorParams) {
    super(params?.message ?? 'Não autorizado', 401, 'UNAUTHORIZED', params?.details);
  }
}

export class ForbiddenError extends AppError {
  constructor(params?: ErrorParams) {
    super(params?.message ?? 'Proibido', 403, 'FORBIDDEN', params?.details);
  }
}

export class NotFoundError extends AppError {
  constructor(params?: ErrorParams) {
    super(params?.message ?? 'Não encontrado', 404, 'NOT_FOUND', params?.details);
  }
}

export class ConflictError extends AppError {
  constructor(params?: ErrorParams) {
    super(params?.message ?? 'Conflito', 409, 'CONFLICT', params?.details);
  }
}

export class ValidationError extends AppError {
  constructor(params?: ErrorParams) {
    super(params?.message ?? 'Erro de validação', 422, 'VALIDATION_ERROR', params?.details);
  }
}

export class InternalServerError extends AppError {
  constructor(params?: ErrorParams) {
    super(
      params?.message ?? 'Erro interno do servidor',
      500,
      'INTERNAL_SERVER_ERROR',
      params?.details,
    );
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(params?: ErrorParams) {
    super(params?.message ?? 'Serviço indisponível', 503, 'SERVICE_UNAVAILABLE', params?.details);
  }
}
