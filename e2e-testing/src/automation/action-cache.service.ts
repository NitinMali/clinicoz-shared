import { Injectable, Optional, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CacheEntry {
  selector: string;
  instructionText: string;
  pageUrl: string;
  lastUsed: number;
  createdAt: number;
}

interface CacheFileData {
  entries: Record<string, CacheEntry & { selectorType: string }>;
  metadata: {
    version: number;
    maxEntries: number;
    entryCount: number;
  };
}

export interface IActionCacheService {
  get(instructionText: string, pageUrl: string): CacheEntry | null;
  set(instructionText: string, pageUrl: string, selector: string): void;
  invalidate(instructionText: string, pageUrl: string): void;
  getStats(): { size: number; maxSize: number };
}

const MAX_ENTRIES = 5000;

/**
 * Generates a deterministic cache key from instruction text and page URL.
 * Uses SHA-256 hash of the concatenation with '|' separator.
 */
export function generateCacheKey(instructionText: string, pageUrl: string): string {
  return crypto
    .createHash('sha256')
    .update(instructionText + '|' + pageUrl)
    .digest('hex');
}

export const CACHE_FILE_PATH = 'CACHE_FILE_PATH';

@Injectable()
export class ActionCacheService implements IActionCacheService {
  private entries: Map<string, CacheEntry & { selectorType: string }>;
  private readonly cacheFilePath: string;

  constructor(@Optional() @Inject(CACHE_FILE_PATH) cacheFilePath?: string) {
    this.cacheFilePath = cacheFilePath ?? path.resolve(process.cwd(), 'cache', 'actions.json');
    this.entries = new Map();
    this.loadFromDisk();
  }

  get(instructionText: string, pageUrl: string): CacheEntry | null {
    const key = generateCacheKey(instructionText, pageUrl);
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    // Update lastUsed timestamp on cache hit
    entry.lastUsed = Date.now();
    this.writeToDisk();
    return {
      selector: entry.selector,
      instructionText: entry.instructionText,
      pageUrl: entry.pageUrl,
      lastUsed: entry.lastUsed,
      createdAt: entry.createdAt,
    };
  }

  set(instructionText: string, pageUrl: string, selector: string): void {
    const key = generateCacheKey(instructionText, pageUrl);

    // If at capacity and this is a new entry, evict LRU
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) {
      this.evictLRU();
    }

    const now = Date.now();
    const existing = this.entries.get(key);

    this.entries.set(key, {
      selector,
      selectorType: 'css',
      instructionText,
      pageUrl,
      lastUsed: now,
      createdAt: existing?.createdAt ?? now,
    });

    this.writeToDisk();
  }

  invalidate(instructionText: string, pageUrl: string): void {
    const key = generateCacheKey(instructionText, pageUrl);
    this.entries.delete(key);
    this.writeToDisk();
  }

  getStats(): { size: number; maxSize: number } {
    return {
      size: this.entries.size,
      maxSize: MAX_ENTRIES,
    };
  }

  clearAll(): void {
    this.entries.clear();
    this.writeToDisk();
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.lastUsed < oldestTimestamp) {
        oldestTimestamp = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.entries.delete(oldestKey);
    }
  }

  private loadFromDisk(): void {
    try {
      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
      const data: CacheFileData = JSON.parse(raw);

      if (data && data.entries && typeof data.entries === 'object') {
        this.entries = new Map(Object.entries(data.entries));
      } else {
        this.entries = new Map();
      }
    } catch {
      // File doesn't exist or is corrupt — start with empty cache
      this.entries = new Map();
    }
  }

  private writeToDisk(): void {
    const data: CacheFileData = {
      entries: Object.fromEntries(this.entries),
      metadata: {
        version: 1,
        maxEntries: MAX_ENTRIES,
        entryCount: this.entries.size,
      },
    };

    // Ensure directory exists
    const dir = path.dirname(this.cacheFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
