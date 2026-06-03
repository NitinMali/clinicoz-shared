import { BrowserFactory, BrowserConfig, detectChromePath, getExpectedPaths } from '../../src/automation/browser.factory';
import { ConfigService } from '../../src/config/config.service';
import * as fs from 'fs';

jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

function createMockConfigService(overrides: Partial<ConfigService> = {}): ConfigService {
  return {
    nodeEnv: 'production',
    port: 3000,
    redisHost: '127.0.0.1',
    redisPort: 6379,
    awsAccessKeyId: 'test-key',
    awsSecretAccessKey: 'test-secret',
    awsRegion: 'us-east-1',
    isDevelopment: false,
    ...overrides,
  } as ConfigService;
}

describe('BrowserFactory', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('createConfig() - production/test mode', () => {
    it('returns headless config when NODE_ENV=production', () => {
      const configService = createMockConfigService({ isDevelopment: false, nodeEnv: 'production' as any });
      const factory = new BrowserFactory(configService);

      const config: BrowserConfig = factory.createConfig();

      expect(config.headless).toBe(true);
      expect(config.executablePath).toBeUndefined();
    });

    it('returns headless config when NODE_ENV=test', () => {
      const configService = createMockConfigService({ isDevelopment: false, nodeEnv: 'test' as any });
      const factory = new BrowserFactory(configService);

      const config: BrowserConfig = factory.createConfig();

      expect(config.headless).toBe(true);
      expect(config.executablePath).toBeUndefined();
    });
  });

  describe('createConfig() - development mode', () => {
    it('returns headed config with executablePath when Chrome is found', () => {
      mockedFs.existsSync.mockReturnValue(true);
      const configService = createMockConfigService({ isDevelopment: true, nodeEnv: 'development' as any });
      const factory = new BrowserFactory(configService);

      const config: BrowserConfig = factory.createConfig();

      expect(config.headless).toBe(false);
      expect(config.executablePath).toBeDefined();
      expect(typeof config.executablePath).toBe('string');
    });

    it('throws error when Chrome is not found in development', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const configService = createMockConfigService({ isDevelopment: true, nodeEnv: 'development' as any });
      const factory = new BrowserFactory(configService);

      expect(() => factory.createConfig()).toThrow(/Native Chrome installation not found/);
    });

    it('error message includes expected paths for the current OS', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const configService = createMockConfigService({ isDevelopment: true, nodeEnv: 'development' as any });
      const factory = new BrowserFactory(configService);

      expect(() => factory.createConfig()).toThrow(process.platform);
    });
  });

  describe('detectChromePath()', () => {
    it('returns first existing path', () => {
      // First call returns false, second returns true
      mockedFs.existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);

      const result = detectChromePath();

      // Should return the second path (first one that exists)
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('returns null when no Chrome paths exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = detectChromePath();

      expect(result).toBeNull();
    });
  });

  describe('getExpectedPaths()', () => {
    it('returns non-empty array of paths for the current platform', () => {
      const paths = getExpectedPaths();

      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      paths.forEach((p) => {
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
      });
    });
  });
});
