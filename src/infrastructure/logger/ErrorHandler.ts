import { logError } from './logger'

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true
  ) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404)
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: Error) {
    super(
      `External service error: ${service}`,
      'EXTERNAL_SERVICE_ERROR',
      503,
      true
    )
    if (originalError) {
      this.stack = originalError.stack
    }
  }
}

export function handleError(error: unknown, context: string): void {
  if (error instanceof AppError) {
    logError(context, error)
    
    if (!error.isOperational) {
      process.exit(1)
    }
  } else {
    logError(context, error)
    
    if (error instanceof Error && !error.message.includes('operational')) {
      process.exit(1)
    }
  }
}

export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    handleError(error, context)
    throw error
  }
}

