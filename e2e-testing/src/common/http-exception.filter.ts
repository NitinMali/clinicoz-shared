import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';

/**
 * Global exception filter that ensures all error responses follow a consistent format:
 * { error: string, message: string, details?: object }
 *
 * Maps known error types to appropriate HTTP status codes:
 * - Validation errors → 400
 * - Auth errors → 401
 * - Queue full → 429
 * - Queue unavailable → 503
 * - AI service errors → 502
 * - Unknown errors → 500
 *
 * Requirements: 1.3, 2.5, 2.6, 3.3, 3.5, 9.4, 9.6
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const { status, body } = this.buildErrorResponse(exception);

    response.status(status).json(body);
  }

  private buildErrorResponse(exception: unknown): {
    status: number;
    body: { error: string; message: string; details?: object };
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // If the exception response already has our expected format, use it directly
      if (this.isStructuredError(exceptionResponse)) {
        return {
          status,
          body: {
            error: exceptionResponse.error,
            message: exceptionResponse.message,
            ...(exceptionResponse.details && { details: exceptionResponse.details }),
          },
        };
      }

      // Handle NestJS BadRequestException from class-validator
      if (exception instanceof BadRequestException) {
        return this.buildValidationError(exceptionResponse);
      }

      // Handle other HttpExceptions with string or generic responses
      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || exception.message;

      return {
        status,
        body: {
          error: this.getErrorCodeFromStatus(status),
          message: Array.isArray(message) ? message.join('; ') : message,
        },
      };
    }

    // Unknown/unhandled exceptions → 500
    const message =
      exception instanceof Error ? exception.message : 'An unexpected error occurred';

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: 'INTERNAL_ERROR',
        message,
      },
    };
  }

  private buildValidationError(exceptionResponse: unknown): {
    status: number;
    body: { error: string; message: string; details?: object };
  } {
    const response = exceptionResponse as any;
    const messages = response.message;

    if (Array.isArray(messages)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: { constraints: messages },
        },
      };
    }

    return {
      status: HttpStatus.BAD_REQUEST,
      body: {
        error: 'VALIDATION_ERROR',
        message: typeof messages === 'string' ? messages : 'Validation failed',
      },
    };
  }

  private isStructuredError(
    response: unknown,
  ): response is { error: string; message: string; details?: object } {
    return (
      typeof response === 'object' &&
      response !== null &&
      'error' in response &&
      'message' in response &&
      typeof (response as any).error === 'string' &&
      typeof (response as any).message === 'string'
    );
  }

  private getErrorCodeFromStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'AUTH_ERROR';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'QUEUE_FULL';
      case HttpStatus.BAD_GATEWAY:
        return 'AI_SERVICE_ERROR';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'QUEUE_UNAVAILABLE';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
