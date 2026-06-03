import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ActionCacheService, generateCacheKey } from '../../src/automation/action-cache.service';

describe('ActionCacheService', () => {
  let tmpDir: string;
  let cacheFilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-cache-test-'));
    cacheFilePath = path.join(tmpDir, 'actions.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateCacheKey', () => {
    it('should produce a SHA-256 hex string', () => {
      const key = generateCacheKey('click submit', 'https://example.com');
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce the same key for the same inputs', () => {
      const key1 = generateCacheKey('click submit', 'https://example.com');
      const key2 = generateCacheKey('click submit', 'https://example.com');
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different instruction texts', () => {
      const key1 = generateCacheKey('click submit', 'https://example.com');
      const key2 = generateCacheKey('click cancel', 'https://example.com');
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different page URLs', () => {
      const key1 = generateCacheKey('click submit', 'https://example.com/a');
      const key2 = generateCacheKey('click submit', 'https://example.com/b');
      expect(key1).not.toBe(key2);
    });
  });

  describe('constructor', () => {
    it('should create an empty cache when file does not exist', () => {
      const service = new ActionCacheService(cacheFilePath);
      expect(service.getStats()).toEqual({ size: 0, maxSize: 5000 });
    });

    it('should load existing cache from disk', () => {
      // Pre-populate a cache file
      const key = generateCacheKey('click btn', 'https://app.com');
      const data = {
        entries: {
          [key]: {
            selector: '#btn',
            selectorType: 'css',
            instructionText: 'click btn',
            pageUrl: 'https://app.com',
            lastUsed: 1000,
            createdAt: 900,
          },
        },
        metadata: { version: 1, maxEntries: 5000, entryCount: 1 },
      };
      fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
      fs.writeFileSync(cacheFilePath, JSON.stringify(data), 'utf-8');

      const service = new ActionCacheService(cacheFilePath);
      expect(service.getStats().size).toBe(1);
    });

    it('should handle corrupt cache file gracefully', () => {
      fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
      fs.writeFileSync(cacheFilePath, 'not valid json!!!', 'utf-8');

      const service = new ActionCacheService(cacheFilePath);
      expect(service.getStats()).toEqual({ size: 0, maxSize: 5000 });
    });
  });

  describe('get()', () => {
    it('should return null for a cache miss', () => {
      const service = new ActionCacheService(cacheFilePath);
      const result = service.get('click submit', 'https://example.com');
      expect(result).toBeNull();
    });

    it('should return cached entry on hit', () => {
      const service = new ActionCacheService(cacheFilePath);
      service.set('click submit', 'https://example.com', '#submit-btn');

      const result = service.get('click submit', 'https://example.com');
      expect(result).not.toBeNull();
      expect(result!.selector).toBe('#submit-btn');
      expect(result!.instructionText).toBe('click submit');
      expect(result!.pageUrl).toBe('https://example.com');
    });

    it('should update lastUsed timestamp on hit', () => {
      const service = new ActionCacheService(cacheFilePath);
      service.set('click submit', 'https://example.com', '#submit-btn');

      const firstGet = service.get('click submit', 'https://example.com');
      const firstLastUsed = firstGet!.lastUsed;

      // Small delay to ensure timestamp changes
      const laterTime = firstLastUsed + 100;
      jest.spyOn(Date, 'now').mockReturnValue(laterTime);

      const secondGet = service.get('click submit', 'https://example.com');
      expect(secondGet!.lastUsed).toBe(laterTime);

      jest.restoreAllMocks();
    });
  });

  describe('set()', () => {
    it('should persist a new entry', () => {
      const service = new ActionCacheService(cacheFilePath);
      service.set('click submit', 'https://example.com', '#submit-btn');

      expect(service.getStats().size).toBe(1);
      const result = service.get('click submit', 'https://example.com');
      expect(result!.selector).toBe('#submit-btn');
    });

    it('should write to disk after set', () => {
      const service = new ActionCacheService(cacheFilePath);
      service.set('click submit', 'https://example.com', '#submit-btn');

      expect(fs.existsSync(cacheFilePath)).toBe(true);
      const raw = fs.readFileSync(cacheFilePath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.metadata.entryCount).toBe(1);
    });

    it('should update existing entry selector', () => {
      const service = new ActionCacheService(cacheFilePath);
      service.set('click submit', 'https://example.com', '#old-btn');
      service.set('click submit', 'https://example.com', '#new-btn');

      expect(service.getStats().size).toBe(1);
      const result = service.get('click submit', 'https://example.com');
      expect(result!.selector).toBe('#new-btn');
    });

    it('should preserve createdAt when updating existing entry', () => {
      const service = new ActionCacheService(cacheFilePath);

      const earlyTime = 1000;
      jest.spyOn(Date, 'now').mockReturnValue(earlyTime);
      service.set('click submit', 'https://example.com', '#old-btn');

      jest.spyOn(Date, 'now').mockReturnValue(2000);
      service.set('click submit', 'https://example.com', '#new-btn');

      const result = service.get('click submit', 'https://example.com');
      expect(result!.createdAt).toBe(earlyTime);

      jest.restoreAllMocks();
    });

    it('should trigger LRU eviction at capacity', () => {
      // Pre-populate the cache file with 5000 entries to avoid slow disk writes
      const entries: Record<string, any> = {};
      for (let i = 0; i < 5000; i++) {
        const key = generateCacheKey(`instruction-${i}`, 'https://example.com');
        entries[key] = {
          selector: `#selector-${i}`,
          selectorType: 'css',
          instructionText: `instruction-${i}`,
          pageUrl: 'https://example.com',
          lastUsed: i + 1, // instruction-0 has lastUsed=1 (oldest)
          createdAt: i + 1,
        };
      }
      const data = {
        entries,
        metadata: { version: 1, maxEntries: 5000, entryCount: 5000 },
      };
      fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
      fs.writeFileSync(cacheFilePath, JSON.stringify(data), 'utf-8');

      const service = new ActionCacheService(cacheFilePath);
      expect(service.getStats().size).toBe(5000);

      // Add one more — should evict the entry with lastUsed=1 (instruction-0)
      jest.spyOn(Date, 'now').mockReturnValue(6000);
      service.set('new-instruction', 'https://example.com', '#new-selector');

      expect(service.getStats().size).toBe(5000);
      // The oldest entry (instruction-0) should be evicted
      const evicted = service.get('instruction-0', 'https://example.com');
      expect(evicted).toBeNull();
      // The new entry should exist
      const newEntry = service.get('new-instruction', 'https://example.com');
      expect(newEntry).not.toBeNull();

      jest.restoreAllMocks();
    });
  });

  describe('invalidate()', () => {
    it('should remove an existing entry', () => {
      const service = new ActionCacheService(cacheFilePath);
      service.set('click submit', 'https://example.com', '#submit-btn');
      service.invalidate('click submit', 'https://example.com');

      expect(service.getStats().size).toBe(0);
      expect(service.get('click submit', 'https://example.com')).toBeNull();
    });

    it('should write to disk after invalidate', () => {
      const service = new ActionCacheService(cacheFilePath);
      service.set('click submit', 'https://example.com', '#submit-btn');
      service.invalidate('click submit', 'https://example.com');

      const raw = fs.readFileSync(cacheFilePath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.metadata.entryCount).toBe(0);
    });

    it('should not throw when invalidating non-existent entry', () => {
      const service = new ActionCacheService(cacheFilePath);
      expect(() => {
        service.invalidate('nonexistent', 'https://example.com');
      }).not.toThrow();
    });
  });

  describe('getStats()', () => {
    it('should return correct size and maxSize', () => {
      const service = new ActionCacheService(cacheFilePath);
      service.set('a', 'https://a.com', '#a');
      service.set('b', 'https://b.com', '#b');

      expect(service.getStats()).toEqual({ size: 2, maxSize: 5000 });
    });
  });

  describe('persistence across instances', () => {
    it('should persist data across service restarts', () => {
      const service1 = new ActionCacheService(cacheFilePath);
      service1.set('click submit', 'https://example.com', '#submit-btn');

      // Create a new instance pointing to the same file
      const service2 = new ActionCacheService(cacheFilePath);
      const result = service2.get('click submit', 'https://example.com');
      expect(result).not.toBeNull();
      expect(result!.selector).toBe('#submit-btn');
    });
  });
});
