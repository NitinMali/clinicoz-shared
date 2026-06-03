import { Injectable } from '@nestjs/common';
import { EnvironmentConfig, validateEnvironment } from './config.schema';

/**
 * Configuration service that validates and provides typed access
 * to environment variables. Validates all required variables at
 * instantiation time and fails fast with descriptive errors.
 */
@Injectable()
export class ConfigService {
  private readonly config: EnvironmentConfig;

  constructor() {
    this.config = validateEnvironment(process.env);
  }

  get nodeEnv(): 'development' | 'production' | 'test' {
    return this.config.NODE_ENV;
  }

  get port(): number {
    return this.config.PORT;
  }

  get redisHost(): string {
    return this.config.REDIS_HOST;
  }

  get redisPort(): number {
    return this.config.REDIS_PORT;
  }

  get isDevelopment(): boolean {
    return this.config.NODE_ENV === 'development';
  }
}
