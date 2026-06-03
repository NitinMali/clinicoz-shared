import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  buildElementMappingSystemPrompt,
  buildElementMappingUserPrompt,
} from './prompt.templates';

/**
 * Result of an AI element mapping request.
 */
export interface ElementMapping {
  selector: string;
  selectorType: 'css' | 'xpath';
  confidence: number;
}

/**
 * Truncates a DOM string to the specified maximum length.
 * Exported standalone for property-based testing.
 */
export function truncateDom(dom: string, maxLength: number = 50_000): string {
  if (dom.length <= maxLength) {
    return dom;
  }
  return dom.substring(0, maxLength);
}

const MAX_RETRIES = 2;

/**
 * AI service using Anthropic API directly (api.anthropic.com).
 * Maps plain-English instructions to web page element selectors.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';

    if (!this.apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY is not set — AI element mapping will fail');
    } else {
      this.logger.log(`Using Anthropic API with model: ${this.model}`);
    }
  }

  async mapInstructionToElement(
    instruction: string,
    domContext: string,
    pageUrl: string,
  ): Promise<ElementMapping> {
    const truncatedDom = truncateDom(domContext);
    const systemPrompt = buildElementMappingSystemPrompt();
    const userPrompt = buildElementMappingUserPrompt(instruction, truncatedDom, pageUrl);
    const responseText = await this.invokeWithRetry(systemPrompt, userPrompt);
    return this.parseResponse(responseText, instruction);
  }

  private async invokeWithRetry(systemPrompt: string, userPrompt: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.invokeModel(systemPrompt, userPrompt);
      } catch (error) {
        lastError = error;
        // Don't retry client errors (4xx)
        if (error instanceof Error && error.message.includes('(4')) throw error;
        if (attempt < MAX_RETRIES) {
          this.logger.warn(`API error on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying...`);
        }
      }
    }
    throw lastError;
  }

  private async invokeModel(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { content?: Array<{ text: string }> };
    if (data.content && data.content.length > 0) {
      return data.content[0].text;
    }
    throw new Error('Unexpected Anthropic API response: no content');
  }

  private parseResponse(responseText: string, instruction: string): ElementMapping {
    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object found in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (error) {
      throw new Error(
        `Failed to parse AI response for instruction "${instruction}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const selector = parsed['selector'];
    const selectorType = parsed['selectorType'];
    const confidence = parsed['confidence'];

    if (typeof selector !== 'string' || selector.length === 0) {
      throw new Error(`AI could not map instruction to element: "${instruction}"`);
    }
    if (selectorType !== 'css' && selectorType !== 'xpath') {
      throw new Error(`Invalid selectorType "${String(selectorType)}" for instruction "${instruction}"`);
    }

    return {
      selector,
      selectorType,
      confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : 0,
    };
  }
}
