import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { ConfigService } from '../config/config.service';

/**
 * Browser launch configuration used by AutomationService
 * when initializing Stagehand.
 */
export interface BrowserConfig {
  headless: boolean;
  executablePath?: string; // native Chrome path for development
}

/**
 * Common Chrome installation paths by operating system.
 */
const CHROME_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ],
};

/**
 * Detects the native Chrome installation path for the current OS.
 * Returns the first path that exists, or null if none found.
 */
export function detectChromePath(): string | null {
  const platform = process.platform;
  const paths = CHROME_PATHS[platform] ?? [];

  for (const chromePath of paths) {
    if (chromePath && fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  return null;
}

/**
 * Returns the expected Chrome paths for the current OS,
 * used in error messages when Chrome is not found.
 */
export function getExpectedPaths(): string[] {
  const platform = process.platform;
  return (CHROME_PATHS[platform] ?? []).filter((p) => p.length > 0);
}

/**
 * Factory that produces browser launch configuration based on
 * the current environment (NODE_ENV).
 *
 * - Development: headed Chrome using native installation
 * - Production/Test: headless Chrome using bundled Chromium
 */
@Injectable()
export class BrowserFactory {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Creates browser configuration appropriate for the current environment.
   *
   * @throws Error if NODE_ENV=development and native Chrome is not found
   */
  createConfig(): BrowserConfig {
    if (this.configService.isDevelopment) {
      return this.createDevelopmentConfig();
    }

    return this.createProductionConfig();
  }

  /**
   * Development mode: headed Chrome with native installation.
   */
  private createDevelopmentConfig(): BrowserConfig {
    const chromePath = detectChromePath();

    if (!chromePath) {
      const expectedPaths = getExpectedPaths();
      throw new Error(
        `Native Chrome installation not found. ` +
          `Please install Google Chrome. Expected paths for ${process.platform}:\n` +
          expectedPaths.map((p) => `  - ${p}`).join('\n'),
      );
    }

    return {
      headless: false,
      executablePath: chromePath,
    };
  }

  /**
   * Production/Test mode: headless Chrome with bundled Chromium.
   */
  private createProductionConfig(): BrowserConfig {
    return {
      headless: true,
    };
  }
}
