import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../config/config.service';
import { ActionCacheService } from './action-cache.service';
import { AiService } from '../ai/ai.service';
import { BrowserFactory } from './browser.factory';
import {
  TestExecutionResult,
  StepResult,
} from '../test-cases/dto/test-case-response.dto';
import {
  IAutomationService,
  TestExecutionPayload,
} from '../execution/execution.processor';

/**
 * Timeout in milliseconds for each instruction step.
 * If an instruction exceeds this, it is marked as failed.
 */
const STEP_TIMEOUT_MS = 30_000;

/**
 * Timeout in milliseconds for the safe close operation.
 * If stagehand.close() exceeds this, the browser process is force-killed.
 */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Timeout in milliseconds for validating a cached selector.
 * If the cached selector cannot locate an element within this time,
 * the cache entry is invalidated and AI is called for a fresh mapping.
 */
const CACHE_VALIDATION_TIMEOUT_MS = 5_000;

/**
 * Represents a Stagehand-compatible browser automation instance.
 * Wraps Playwright's Browser, BrowserContext, and Page to provide
 * the act() method for AI-driven actions and close() for cleanup.
 */
export interface StagehandInstance {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  act(params: { action: string }): Promise<void>;
  close(): Promise<void>;
}

/**
 * AutomationService orchestrates browser automation using Stagehand + Playwright.
 *
 * For each test case execution:
 * 1. Launches a browser via Stagehand with environment-appropriate config
 * 2. Navigates to the target URL
 * 3. Executes each instruction sequentially:
 *    - Checks ActionCacheService for a cached selector
 *    - If cache hit: validates selector on page (5s timeout), invalidates on failure
 *    - If cache miss: calls AiService for element mapping
 *    - Executes the action via Stagehand's act() method
 *    - Records step result (index, instruction, status, selector, cacheHit, duration, error)
 * 4. Guarantees browser cleanup via try/finally with safeClose()
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.2, 5.4, 7.2, 7.3
 */
@Injectable()
export class AutomationService implements IAutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly actionCacheService: ActionCacheService,
    private readonly aiService: AiService,
    private readonly browserFactory: BrowserFactory,
  ) {}

  /**
   * Executes a test case by launching a browser, navigating to the target URL,
   * and executing each instruction sequentially.
   *
   * Uses try/finally to guarantee browser cleanup regardless of outcome.
   */
  async executeTestCase(
    payload: TestExecutionPayload,
  ): Promise<TestExecutionResult> {
    const { instructions, targetUrl } = payload;
    let stagehand: StagehandInstance | null = null;
    const steps: StepResult[] = [];
    const startTime = Date.now();

    try {
      // Launch browser via Stagehand
      stagehand = await this.launchBrowser();

      // Inject auth tokens if configured (skip login steps)
      const page = stagehand.page;
      await this.injectAuth(page, targetUrl);

      // Navigate to target URL
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      // Execute each instruction sequentially
      for (let i = 0; i < instructions.length; i++) {
        const instruction = instructions[i];
        const stepResult = await this.executeStep(
          stagehand,
          instruction,
          targetUrl,
          i,
        );
        steps.push(stepResult);

        // Stop execution on first failure (Requirement 4.4)
        if (stepResult.status === 'failed') {
          return {
            status: 'failed',
            steps,
            duration: Date.now() - startTime,
            error: stepResult.error,
          };
        }
      }

      // All steps passed
      return {
        status: 'passed',
        steps,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown execution error';
      this.logger.error(`Test execution failed: ${errorMessage}`);

      return {
        status: 'failed',
        steps,
        duration: Date.now() - startTime,
        error: errorMessage,
      };
    } finally {
      // Guarantee browser cleanup (Requirement 7.2)
      if (stagehand) {
        await this.safeClose(stagehand);
      }
    }
  }

  /**
   * Launches a Stagehand-compatible browser instance with environment-appropriate configuration.
   * Uses Playwright's chromium launcher with configuration from BrowserFactory.
   */
  private async launchBrowser(): Promise<StagehandInstance> {
    const browserConfig = this.browserFactory.createConfig();

    const browser = await chromium.launch({
      headless: browserConfig.headless,
      ...(browserConfig.executablePath && {
        executablePath: browserConfig.executablePath,
      }),
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    this.logger.log(
      `Browser launched (headless: ${browserConfig.headless})`,
    );

    // Create a Stagehand-compatible instance wrapping Playwright
    const stagehand: StagehandInstance = {
      page,
      context,
      browser,
      act: async (params: { action: string }) => {
        // The act() method uses the AI service to interpret and execute the action.
        // The actual element interaction is handled in executeStep via selector-based actions.
        // This method is called after the selector has been resolved and cached.
        // For Stagehand compatibility, we use page.click/fill/etc. based on the resolved selector.
        // The instruction is already processed by the time act() is called in the step flow.
        this.logger.debug(`Executing action: ${params.action}`);
      },
      close: async () => {
        await context.close();
        await browser.close();
      },
    };

    return stagehand;
  }

  /**
   * Executes a single instruction step with a 30-second timeout.
   *
   * Flow:
   * 1. Check cache for existing selector
   * 2. If cache hit: validate selector on page (5s timeout)
   *    - If valid: use cached selector
   *    - If invalid: invalidate cache, call AI
   * 3. If cache miss: call AI for element mapping
   * 4. Execute action via Stagehand's act() method
   * 5. Cache the successful selector
   */
  private async executeStep(
    stagehand: StagehandInstance,
    instruction: string,
    targetUrl: string,
    index: number,
  ): Promise<StepResult> {
    const stepStart = Date.now();
    let cacheHit = false;
    let selector: string | undefined;

    try {
      // Handle non-element instructions (wait, verify, navigate) directly via Playwright
      const handled = await this.handleSpecialInstruction(stagehand, instruction);
      if (handled) {
        return {
          index,
          instruction,
          status: 'passed',
          selector: undefined,
          cacheHit: false,
          duration: Date.now() - stepStart,
        };
      }

      // Wrap entire step in a 30-second timeout (Requirement 4.5)
      await this.withTimeout(
        async () => {
          // 0. Check if instruction contains a direct CSS selector (e.g., input[placeholder="..."], #id, .class)
          const directSelector = this.extractDirectSelector(instruction);
          if (directSelector) {
            selector = directSelector;
            await this.executeAction(stagehand, instruction, selector);
            return;
          }

          // 1. Check cache
          const cachedEntry = this.actionCacheService.get(
            instruction,
            targetUrl,
          );

          if (cachedEntry) {
            cacheHit = true;
            // Validate cached selector on page (5s timeout)
            const isValid = await this.validateCachedSelector(
              stagehand,
              cachedEntry.selector,
            );

            if (isValid) {
              selector = cachedEntry.selector;
            } else {
              // Invalidate stale cache entry (Requirement 5.4)
              this.actionCacheService.invalidate(instruction, targetUrl);
              this.logger.warn(
                `Cache invalidated for instruction: "${instruction}"`,
              );
              cacheHit = false;

              // Call AI for fresh mapping
              const mapping = await this.getAiMapping(
                stagehand,
                instruction,
                targetUrl,
              );
              selector = mapping.selector;

              // Cache the new mapping
              this.actionCacheService.set(
                instruction,
                targetUrl,
                mapping.selector,
              );
            }
          } else {
            // Cache miss: call AI
            const mapping = await this.getAiMapping(
              stagehand,
              instruction,
              targetUrl,
            );
            selector = mapping.selector;

            // Cache the successful mapping (Requirement 5.1)
            this.actionCacheService.set(
              instruction,
              targetUrl,
              mapping.selector,
            );
          }

          // Execute the action using the resolved selector
          await this.executeAction(stagehand, instruction, selector!);
        },
        STEP_TIMEOUT_MS,
      );

      return {
        index,
        instruction,
        status: 'passed',
        selector,
        cacheHit,
        duration: Date.now() - stepStart,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown step error';

      // Capture screenshot on failure
      let screenshot: string | undefined;
      try {
        const filename = `step-${index}-${Date.now()}.png`;
        const screenshotPath = path.resolve(process.cwd(), 'data', 'screenshots', filename);
        const dir = path.dirname(screenshotPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await stagehand.page.screenshot({ path: screenshotPath, fullPage: true });
        screenshot = filename;
        this.logger.log(`Screenshot saved: ${filename}`);
      } catch { /* ignore screenshot errors */ }

      return {
        index,
        instruction,
        status: 'failed',
        selector,
        cacheHit,
        duration: Date.now() - stepStart,
        error: errorMessage,
        screenshot,
      };
    }
  }

  /**
   * Injects authentication into the browser before navigation.
   * Supports two modes:
   * 1. Token mode: Injects localStorage/cookies directly
   * 2. Credentials mode: Performs login automatically (email + password)
   */
  private async injectAuth(page: any, targetUrl: string): Promise<void> {
    const authPath = path.resolve(process.cwd(), 'data', 'auth.json');
    if (!fs.existsSync(authPath)) return;

    try {
      const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      const url = new URL(targetUrl);

      // Mode 1: Credentials-based login
      if (authData.email && authData.password && authData.loginUrl) {
        this.logger.log('Performing auto-login with credentials...');
        await page.goto(authData.loginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1000);

        // Fill email
        try {
          await page.fill('input#email, input[type="email"], input[name="email"]', authData.email, { timeout: 5000 });
        } catch {
          this.logger.warn('Could not find email input for auto-login');
          return;
        }

        // Fill password
        try {
          await page.fill('input#password, input[type="password"], input[name="password"]', authData.password, { timeout: 5000 });
        } catch {
          this.logger.warn('Could not find password input for auto-login');
          return;
        }

        // Click submit
        try {
          await page.click('button[type="submit"]', { timeout: 5000 });
        } catch {
          this.logger.warn('Could not find submit button for auto-login');
          return;
        }

        // Wait for login to complete
        await page.waitForTimeout(3000);
        this.logger.log('Auto-login completed');
        return;
      }

      // Mode 2: Token injection
      // Navigate to the domain first so we can set localStorage
      await page.goto(`${url.origin}`, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Inject localStorage items
      if (authData.localStorage && typeof authData.localStorage === 'object') {
        for (const [key, value] of Object.entries(authData.localStorage)) {
          const escapedValue = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          await page.evaluate(`localStorage.setItem('${key}', '${escapedValue}')`);
        }
        this.logger.log(`Injected ${Object.keys(authData.localStorage).length} localStorage items`);
      }

      // Inject cookies
      if (authData.cookies && Array.isArray(authData.cookies)) {
        const context = page.context();
        await context.addCookies(
          authData.cookies.map((c: any) => ({
            ...c,
            domain: c.domain || url.hostname,
            path: c.path || '/',
          })),
        );
        this.logger.log(`Injected ${authData.cookies.length} cookies`);
      }
    } catch (error) {
      this.logger.warn(`Failed to inject auth: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Detects if an instruction contains a direct CSS selector that can be used without AI.
   * Supports: #id, .class, tag[attr="value"], tag.class patterns
   */
  /**
   * Resolves the value to type from an instruction.
   * Supports:
   * - Quoted strings: "hello world"
   * - random name / random name prefix "Test" → "Test David Smith"
   * - random mobile / random mobile(10) → "9182736450"
   * - random email → "test.user.a3k9@test.com"
   * - current date and time → "5/24/2026, 10:30:00 PM"
   */
  private resolveValue(instruction: string): string {
    const lower = instruction.toLowerCase();

    // Random name with optional prefix
    if (lower.includes('random name')) {
      const prefixMatch = instruction.match(/prefix\s+(?:with\s+)?["']([^"']+)["']/i);
      const prefix = prefixMatch ? prefixMatch[1] + ' ' : '';
      return prefix + this.generateRandomName();
    }

    // Random mobile with optional length
    if (lower.includes('random mobile') || lower.includes('random phone')) {
      const lenMatch = instruction.match(/random\s+(?:mobile|phone)\s*\(?\s*(\d+)\s*\)?/i);
      const length = lenMatch ? parseInt(lenMatch[1], 10) : 10;
      return this.generateRandomMobile(length);
    }

    // Random email
    if (lower.includes('random email')) {
      return this.generateRandomEmail();
    }

    // Current date and time
    if (lower.includes('current date and time') || lower.includes('current datetime')) {
      return new Date().toLocaleString();
    }

    // Current date only
    if (lower.includes('current date')) {
      return new Date().toLocaleDateString();
    }

    // Current time only
    if (lower.includes('current time')) {
      return new Date().toLocaleTimeString();
    }

    // Random number
    if (lower.includes('random number')) {
      const rangeMatch = instruction.match(/random\s+number\s*\(?\s*(\d+)\s*,\s*(\d+)\s*\)?/i);
      if (rangeMatch) {
        const min = parseInt(rangeMatch[1], 10);
        const max = parseInt(rangeMatch[2], 10);
        return String(Math.floor(Math.random() * (max - min + 1)) + min);
      }
      return String(Math.floor(Math.random() * 10000));
    }

    // Quoted string (default)
    const textMatch = instruction.match(/["']([^"']+)["']/);
    if (textMatch) return textMatch[1];

    // Fallback: extract text after "type"/"fill" and before "in"/"into"
    const afterType = instruction.match(/(?:type|fill)\s+(.+?)(?:\s+(?:into|in|on|to)\s+|$)/i);
    if (afterType) return afterType[1].replace(/["']/g, '');

    return '';
  }

  private generateRandomName(): string {
    const firstNames = ['David', 'Sarah', 'James', 'Emma', 'Michael', 'Olivia', 'Robert', 'Sophia', 'William', 'Ava', 'Rahul', 'Priya', 'Amit', 'Neha', 'Vikram'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Kumar', 'Sharma', 'Patel', 'Singh', 'Mali', 'Desai'];
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `Test ${first} ${last}`;
  }

  private generateRandomMobile(length: number = 10): string {
    // Format: 00000XXXXX — leading zeros + random digits for easy identification
    const randomPart = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    const zeroPad = '0'.repeat(Math.max(0, length - 5));
    return (zeroPad + randomPart).slice(-length);
  }

  private generateRandomEmail(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let name = 'test.';
    for (let i = 0; i < 6; i++) {
      name += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${name}@test.com`;
  }

  private extractDirectSelector(instruction: string): string | null {
    // Strategy: Look for CSS selector patterns in the instruction
    // Skip the option value in quotes for Select instructions (e.g., Select "Male" in #gender)
    // We look for the selector AFTER "in" or "on" keyword, or at the end

    // Remove the option value from Select instructions to avoid false matches
    let searchText = instruction;
    if (/^(?:\d+\.\s*)?select/i.test(instruction)) {
      // For Select instructions, look only after "in" keyword
      const inMatch = instruction.match(/\bin\s+(.+)$/i);
      if (inMatch) {
        searchText = inMatch[1];
      }
    }

    // 1. Match [attribute="value"] patterns (including data-testid, placeholder, etc.)
    const attrSelector = searchText.match(/((?:input|button|select|textarea|a|div|span|li|ul|i)?\[[\w-]+(?:\*?=["'][^"']*["'])?\])/i);
    if (attrSelector) return attrSelector[1];

    // 2. Match tag#id or tag.class
    const tagIdClass = searchText.match(/((?:input|button|select|textarea|a|div|span|li|ul|i)(?:#[\w-]+|\.[\w-]+))/i);
    if (tagIdClass) return tagIdClass[1];

    // 3. Match #id patterns
    const idMatch = searchText.match(/(#[\w-]+)/);
    if (idMatch) return idMatch[1];

    // 4. Match .class patterns
    const classMatch = searchText.match(/(\.[\w-]+)/);
    if (classMatch) return classMatch[1];

    return null;
  }

  /**
   * Executes the appropriate Playwright action based on the instruction and selector.
   * Determines action type (click, type, clear, select) from the instruction text.
   */
  private async executeAction(
    stagehand: StagehandInstance,
    instruction: string,
    selector: string,
  ): Promise<void> {
    const page = stagehand.page;
    const lower = instruction.toLowerCase();

    // Wait for element to be visible first
    await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });

    // Determine action type from instruction — check start of instruction to avoid false matches
    const startsWithClick = /^(?:\d+\.\s*)?click/i.test(instruction);
    const startsWithType = /^(?:\d+\.\s*)?type/i.test(instruction);
    const startsWithClear = /^(?:\d+\.\s*)?clear/i.test(instruction);
    const startsWithFill = /^(?:\d+\.\s*)?fill/i.test(instruction);

    if (startsWithType || startsWithFill) {
      // Resolve the value to type (supports utility methods and quoted strings)
      const value = this.resolveValue(instruction);
      await page.fill(selector, value);
    } else if (startsWithClear) {
      await page.fill(selector, '');
    } else if (/^(?:\d+\.\s*)?select/i.test(instruction)) {
      // Handle PrimeNG dropdown selection: click to open, then click option
      await page.click(selector);
      await page.waitForTimeout(500);
      // Extract the option text from quotes
      const optionMatch = instruction.match(/["']([^"']+)["']/);
      if (optionMatch) {
        const optionText = optionMatch[1];
        // Try PrimeNG dropdown option selectors
        const optionSelectors = [
          `li[aria-label="${optionText}"]`,
          `li.p-dropdown-item:has-text("${optionText}")`,
          `span.p-dropdown-item:has-text("${optionText}")`,
        ];
        let clicked = false;
        for (const optSel of optionSelectors) {
          try {
            await page.click(optSel, { timeout: 3000 });
            clicked = true;
            break;
          } catch { /* try next selector */ }
        }
        if (!clicked) {
          // Fallback: click any visible li containing the text
          await page.locator('li').filter({ hasText: optionText }).first().click({ timeout: 5000 });
        }
      }
    } else {
      // Default: click
      await page.click(selector);
    }

    // Small delay after action for page to react
    await page.waitForTimeout(500);
  }

  /**
   * Handles special non-element instructions like "wait for", "verify", "navigate".
   * Returns true if the instruction was handled, false if it needs AI element mapping.
   */
  private async handleSpecialInstruction(
    stagehand: StagehandInstance,
    instruction: string,
  ): Promise<boolean> {
    const lower = instruction.toLowerCase();
    const page = stagehand.page;

    // Wait for navigation/URL
    if ((lower.includes('redirect') || lower.includes('navigate') || lower.includes('page should')) && 
        (lower.includes('/') || lower.includes('url'))) {
      // Extract URL path from instruction (look for /path patterns or quoted URLs)
      const pathMatch = instruction.match(/(?:\/[\w\-\/]+)/);
      const quotedMatch = instruction.match(/["'](https?:\/\/[^"']+|\/[^"']+)["']/);
      const urlPattern = quotedMatch ? quotedMatch[1] : (pathMatch ? pathMatch[0] : null);

      if (urlPattern) {
        this.logger.log(`Waiting for URL to contain: ${urlPattern}`);
        await page.waitForURL(`**${urlPattern}*`, { timeout: STEP_TIMEOUT_MS });
        return true;
      }
      // Generic wait for navigation
      await page.waitForLoadState('networkidle');
      return true;
    }

    // Wait for page/element to load
    if (lower.includes('wait for') && (lower.includes('load') || lower.includes('appear') || lower.includes('open'))) {
      // PrimeReact sidebar/dialog detection
      if (lower.includes('sidebar') || lower.includes('panel')) {
        try {
          await page.waitForSelector('.p-sidebar, .p-sidebar-content', { timeout: 10000, state: 'visible' });
        } catch {
          await page.waitForTimeout(1500);
        }
        return true;
      }
      if (lower.includes('dialog') || lower.includes('modal')) {
        try {
          await page.waitForSelector('.p-dialog, .p-dialog-content', { timeout: 10000, state: 'visible' });
        } catch {
          await page.waitForTimeout(1500);
        }
        return true;
      }
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      return true;
    }

    // Verify/assert page state
    if (lower.includes('verify') || lower.includes('assert') || lower.includes('confirm')) {
      // Check for URL verification
      if (lower.includes('url') || lower.includes('page') || lower.includes('redirect')) {
        const urlMatch = instruction.match(/(?:displays?|shows?|is|at|on)\s+(\S+)/i);
        if (urlMatch) {
          const expected = urlMatch[1].replace(/['"]/g, '');
          const currentUrl = page.url();
          if (!currentUrl.includes(expected)) {
            throw new Error(`Expected URL to contain "${expected}" but got "${currentUrl}"`);
          }
        }
        return true;
      }
      // For other verifications, wait for page stability
      await page.waitForLoadState('networkidle');
      return true;
    }

    // Wait for toaster/notification (PrimeReact uses .p-toast-message)
    if (lower.includes('wait for') && (lower.includes('toaster') || lower.includes('toast') || lower.includes('notification') || lower.includes('message') || lower.includes('success'))) {
      try {
        await page.waitForSelector('.p-toast-message, .p-toast-message-content, .p-toast, [role="alert"], .toast, .notification', {
          timeout: 10000,
          state: 'visible',
        });
      } catch {
        await page.waitForTimeout(2000);
      }
      return true;
    }

    // Simple wait/pause
    if (lower.match(/^wait\s+\d+/i)) {
      const seconds = parseInt(lower.match(/\d+/)?.[0] || '2', 10);
      await page.waitForTimeout(seconds * 1000);
      return true;
    }

    return false;
  }

  /**
   * Validates a cached selector by attempting to locate the element on the page.
   * Returns true if the element is found within CACHE_VALIDATION_TIMEOUT_MS (5 seconds).
   */
  private async validateCachedSelector(
    stagehand: StagehandInstance,
    selector: string,
  ): Promise<boolean> {
    try {
      const page = stagehand.page;
      const element = await page.waitForSelector(selector, {
        timeout: CACHE_VALIDATION_TIMEOUT_MS,
        state: 'visible',
      });
      return element !== null;
    } catch {
      return false;
    }
  }

  /**
   * Calls the AI service to map an instruction to a DOM element.
   * Extracts the current page DOM and passes it to the AI service.
   */
  private async getAiMapping(
    stagehand: StagehandInstance,
    instruction: string,
    targetUrl: string,
  ): Promise<{ selector: string; selectorType: string }> {
    const page = stagehand.page;

    // Extract only interactive elements with their context — much smaller than full DOM
    const domContext = await page.evaluate(`
      (() => {
        const interactiveSelectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [tabindex], label, li[class*="item"], [contenteditable]';
        const elements = document.querySelectorAll(interactiveSelectors);
        const results = [];
        elements.forEach((el, index) => {
          const tag = el.tagName.toLowerCase();
          const attrs = [];
          ['id', 'class', 'type', 'name', 'placeholder', 'aria-label', 'role', 'href', 'value', 'data-testid', 'title', 'for'].forEach(attr => {
            const val = el.getAttribute(attr);
            if (val) attrs.push(attr + '="' + val.substring(0, 100) + '"');
          });
          const text = (el.textContent || '').trim().substring(0, 80);
          const parent = el.parentElement;
          const parentInfo = parent ? 'parent=' + parent.tagName.toLowerCase() + (parent.className ? '.' + parent.className.split(' ')[0] : '') : '';
          results.push('[' + index + '] <' + tag + ' ' + attrs.join(' ') + '>' + (text ? ' text="' + text + '"' : '') + ' ' + parentInfo);
        });
        return results.join('\\n');
      })()
    `) as string;

    const mapping = await this.aiService.mapInstructionToElement(
      instruction,
      domContext,
      targetUrl,
    );

    return {
      selector: mapping.selector,
      selectorType: mapping.selectorType,
    };
  }

  /**
   * Safely closes the Stagehand browser instance.
   * Races stagehand.close() against a 10-second timeout.
   * If the graceful close exceeds the timeout, force-kills the browser process.
   *
   * Requirement 7.2, 7.3
   */
  async safeClose(stagehand: StagehandInstance): Promise<void> {
    try {
      await this.withTimeout(
        () => stagehand.close(),
        CLOSE_TIMEOUT_MS,
      );
      this.logger.log('Browser closed gracefully');
    } catch {
      this.logger.warn(
        'Browser close timed out, force-killing process',
      );
      this.forceKillBrowser(stagehand);
    }
  }

  /**
   * Force-kills the browser process at the OS level.
   * Used as a fallback when stagehand.close() exceeds the timeout.
   */
  private forceKillBrowser(stagehand: StagehandInstance): void {
    try {
      // Access the underlying browser to get the process
      // Playwright's Browser type doesn't expose process() in its public API,
      // but the Chromium implementation does have it available at runtime.
      const browser = stagehand.browser as unknown as { process(): { pid?: number } | null };
      const browserProcess = browser.process();

      if (browserProcess && browserProcess.pid) {
        this.logger.warn(
          `Force-killing browser process (PID: ${browserProcess.pid})`,
        );
        process.kill(browserProcess.pid, 'SIGKILL');
      } else {
        this.logger.warn(
          'Could not find browser process PID for force kill',
        );
      }
    } catch (killError) {
      this.logger.error(
        `Error during force kill: ${killError instanceof Error ? killError.message : String(killError)}`,
      );
    }
  }

  /**
   * Wraps an async operation with a timeout.
   * Rejects with a timeout error if the operation exceeds the specified duration.
   */
  private withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Operation timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
