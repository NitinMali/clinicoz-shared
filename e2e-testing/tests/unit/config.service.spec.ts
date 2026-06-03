import { validateEnvironment } from '../../src/config/config.schema';

describe('ConfigService - validateEnvironment', () => {
  const validEnv = {
    NODE_ENV: 'development',
    AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    AWS_REGION: 'us-east-1',
  };

  it('should accept valid environment with all required vars', () => {
    const config = validateEnvironment(validEnv);
    expect(config.NODE_ENV).toBe('development');
    expect(config.AWS_ACCESS_KEY_ID).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(config.AWS_SECRET_ACCESS_KEY).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    expect(config.AWS_REGION).toBe('us-east-1');
  });

  it('should apply default PORT=3000 when PORT is not specified', () => {
    const config = validateEnvironment(validEnv);
    expect(config.PORT).toBe(3000);
  });

  it('should apply default REDIS_HOST="127.0.0.1" when not specified', () => {
    const config = validateEnvironment(validEnv);
    expect(config.REDIS_HOST).toBe('127.0.0.1');
  });

  it('should apply default REDIS_PORT=6379 when not specified', () => {
    const config = validateEnvironment(validEnv);
    expect(config.REDIS_PORT).toBe(6379);
  });

  it('should accept custom PORT value within valid range', () => {
    const config = validateEnvironment({ ...validEnv, PORT: '8080' });
    expect(config.PORT).toBe(8080);
  });

  it('should accept NODE_ENV=production', () => {
    const config = validateEnvironment({ ...validEnv, NODE_ENV: 'production' });
    expect(config.NODE_ENV).toBe('production');
  });

  it('should accept NODE_ENV=test', () => {
    const config = validateEnvironment({ ...validEnv, NODE_ENV: 'test' });
    expect(config.NODE_ENV).toBe('test');
  });

  it('should reject missing NODE_ENV', () => {
    const { NODE_ENV, ...envWithout } = validEnv;
    expect(() => validateEnvironment(envWithout)).toThrow(
      /Required environment variable NODE_ENV is missing/,
    );
  });

  it('should reject missing AWS_ACCESS_KEY_ID', () => {
    const { AWS_ACCESS_KEY_ID, ...envWithout } = validEnv;
    expect(() => validateEnvironment(envWithout)).toThrow(
      /Required environment variable AWS_ACCESS_KEY_ID is missing/,
    );
  });

  it('should reject missing AWS_SECRET_ACCESS_KEY', () => {
    const { AWS_SECRET_ACCESS_KEY, ...envWithout } = validEnv;
    expect(() => validateEnvironment(envWithout)).toThrow(
      /Required environment variable AWS_SECRET_ACCESS_KEY is missing/,
    );
  });

  it('should reject missing AWS_REGION', () => {
    const { AWS_REGION, ...envWithout } = validEnv;
    expect(() => validateEnvironment(envWithout)).toThrow(
      /Required environment variable AWS_REGION is missing/,
    );
  });

  it('should list all missing variables in a single error', () => {
    expect(() => validateEnvironment({})).toThrow(
      /NODE_ENV.*AWS_ACCESS_KEY_ID.*AWS_SECRET_ACCESS_KEY.*AWS_REGION/s,
    );
  });

  it('should reject invalid NODE_ENV value', () => {
    expect(() =>
      validateEnvironment({ ...validEnv, NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV must be one of/);
  });

  it('should reject non-numeric PORT', () => {
    expect(() =>
      validateEnvironment({ ...validEnv, PORT: 'abc' }),
    ).toThrow(/PORT must be a numeric value between 1 and 65535/);
  });

  it('should reject PORT=0 (below range)', () => {
    expect(() =>
      validateEnvironment({ ...validEnv, PORT: '0' }),
    ).toThrow(/PORT must be a numeric value between 1 and 65535/);
  });

  it('should reject PORT=65536 (above range)', () => {
    expect(() =>
      validateEnvironment({ ...validEnv, PORT: '65536' }),
    ).toThrow(/PORT must be a numeric value between 1 and 65535/);
  });

  it('should reject PORT with decimal value', () => {
    expect(() =>
      validateEnvironment({ ...validEnv, PORT: '3000.5' }),
    ).toThrow(/PORT must be a numeric value between 1 and 65535/);
  });

  it('should accept PORT=1 (minimum valid)', () => {
    const config = validateEnvironment({ ...validEnv, PORT: '1' });
    expect(config.PORT).toBe(1);
  });

  it('should accept PORT=65535 (maximum valid)', () => {
    const config = validateEnvironment({ ...validEnv, PORT: '65535' });
    expect(config.PORT).toBe(65535);
  });

  it('should reject empty string for required variables', () => {
    expect(() =>
      validateEnvironment({ ...validEnv, AWS_REGION: '' }),
    ).toThrow(/Required environment variable AWS_REGION is missing/);
  });

  it('should reject whitespace-only string for required variables', () => {
    expect(() =>
      validateEnvironment({ ...validEnv, NODE_ENV: '   ' }),
    ).toThrow(/Required environment variable NODE_ENV is missing/);
  });

  it('should use custom REDIS_HOST when provided', () => {
    const config = validateEnvironment({ ...validEnv, REDIS_HOST: 'redis.example.com' });
    expect(config.REDIS_HOST).toBe('redis.example.com');
  });

  it('should use custom REDIS_PORT when provided', () => {
    const config = validateEnvironment({ ...validEnv, REDIS_PORT: '6380' });
    expect(config.REDIS_PORT).toBe(6380);
  });
});
