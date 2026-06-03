/**
 * Environment configuration validation schema.
 * Validates all required and optional environment variables at startup.
 */

export interface EnvironmentConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  REDIS_HOST: string;
  REDIS_PORT: number;
}

export interface ValidationError {
  variable: string;
  message: string;
}

const VALID_NODE_ENVS = ['development', 'production', 'test'] as const;

const REQUIRED_VARIABLES = ['NODE_ENV'] as const;

const DEFAULTS: Partial<Record<string, string>> = {
  PORT: '3000',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
};

/**
 * Validates environment variables and returns a validated config or throws
 * with descriptive error messages listing all missing/invalid variables.
 */
export function validateEnvironment(
  env: Record<string, string | undefined>,
): EnvironmentConfig {
  const errors: ValidationError[] = [];

  // Check required variables
  for (const varName of REQUIRED_VARIABLES) {
    if (!env[varName] || env[varName]!.trim() === '') {
      errors.push({
        variable: varName,
        message: `Required environment variable ${varName} is missing`,
      });
    }
  }

  // Validate NODE_ENV value if present
  const nodeEnv = env.NODE_ENV?.trim();
  if (nodeEnv && !VALID_NODE_ENVS.includes(nodeEnv as any)) {
    errors.push({
      variable: 'NODE_ENV',
      message: `NODE_ENV must be one of: ${VALID_NODE_ENVS.join(', ')}. Got: "${nodeEnv}"`,
    });
  }

  // Apply defaults and validate PORT
  const portStr = env.PORT ?? DEFAULTS.PORT!;
  const port = Number(portStr);
  if (isNaN(port) || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push({
      variable: 'PORT',
      message: `PORT must be a numeric value between 1 and 65535. Got: "${portStr}"`,
    });
  }

  // Validate REDIS_PORT if provided
  const redisPortStr = env.REDIS_PORT ?? DEFAULTS.REDIS_PORT!;
  const redisPort = Number(redisPortStr);
  if (isNaN(redisPort) || !Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65535) {
    errors.push({
      variable: 'REDIS_PORT',
      message: `REDIS_PORT must be a numeric value between 1 and 65535. Got: "${redisPortStr}"`,
    });
  }

  // If there are errors, throw with descriptive message
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `  - ${e.message}`).join('\n');
    throw new Error(
      `Environment configuration validation failed:\n${errorMessages}`,
    );
  }

  return {
    NODE_ENV: nodeEnv as EnvironmentConfig['NODE_ENV'],
    PORT: port,
    REDIS_HOST: env.REDIS_HOST ?? DEFAULTS.REDIS_HOST!,
    REDIS_PORT: redisPort,
  };
}
