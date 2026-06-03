import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Custom exception classes for consistent error handling.
 * Each maps to a specific HTTP status code and error category.
 *
 * Requirements: 2.5, 2.6, 3.5, 9.4, 9.6
 */

/**
 * Thrown when the Redis/BullMQ job queue is unreachable.
 * HTTP 503 Service Unavailable.
 */
export class QueueUnavailableException extends HttpException {
  constructor(message = 'Job queue is not reachable') {
    super(
      {
        error: 'QUEUE_UNAVAILABLE',
        message,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * Thrown when the job queue has reached maximum capacity (20 pending jobs).
 * HTTP 429 Too Many Requests.
 */
export class QueueFullException extends HttpException {
  constructor(message = 'Maximum queue capacity reached') {
    super(
      {
        error: 'QUEUE_FULL',
        message,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Thrown when Amazon Bedrock / AI service is unreachable or returns an error.
 * HTTP 502 Bad Gateway.
 */
export class AiServiceException extends HttpException {
  constructor(message = 'AI service is unavailable') {
    super(
      {
        error: 'AI_SERVICE_ERROR',
        message,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * Thrown when AWS credentials are missing or invalid.
 * HTTP 401 Unauthorized.
 */
export class AuthException extends HttpException {
  constructor(message = 'AWS Bedrock authentication failed') {
    super(
      {
        error: 'AUTH_ERROR',
        message,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
