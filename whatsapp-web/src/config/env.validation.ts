import * as Joi from 'joi';

const envSchema = Joi.object({
  PORT: Joi.number().default(3001),
  REDIS_URL: Joi.string().uri().required().messages({
    'any.required': 'REDIS_URL is required',
    'string.uri': 'REDIS_URL must be a valid URI',
    'string.empty': 'REDIS_URL is required',
  }),
  API_KEY: Joi.string().min(16).required().messages({
    'any.required': 'API_KEY is required',
    'string.min': 'API_KEY must be at least 16 characters',
    'string.empty': 'API_KEY is required',
  }),
  SESSION_IDLE_TIMEOUT_MS: Joi.number().default(600000), // 10 minutes
}).unknown(true);

export function validate(config: Record<string, unknown>): Record<string, unknown> {
  const { error, value } = envSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
  });

  if (error) {
    const missingVars = error.details.map((d) => d.message).join('; ');
    throw new Error(`Environment validation failed: ${missingVars}`);
  }

  return value;
}
