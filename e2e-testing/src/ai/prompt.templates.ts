/**
 * Structured prompt templates for AI-powered element mapping.
 * Used by AiService to instruct Claude 3.5 Sonnet on how to
 * identify web page elements from plain-English instructions.
 */

/**
 * Builds the system prompt for element mapping requests.
 * Instructs the model to return a JSON response with selector info.
 */
export function buildElementMappingSystemPrompt(): string {
  return `You are an expert web automation assistant. Your task is to identify a single DOM element that matches a user's plain-English instruction.

You will receive:
1. A user instruction describing an action to perform on a web page element
2. The current page DOM (HTML) context
3. The page URL for context

You MUST respond with ONLY a valid JSON object (no markdown, no explanation) in this exact format:
{
  "selector": "<css-or-xpath-selector>",
  "selectorType": "css" | "xpath",
  "confidence": <number between 0 and 1>
}

Rules:
- The selector MUST uniquely identify exactly ONE element in the provided DOM
- Prefer CSS selectors over XPath when possible (they are more readable and performant)
- Use XPath only when CSS cannot express the selection (e.g., text content matching)
- The confidence score should reflect how certain you are that the selector matches the intended element
- If you cannot identify a matching element, respond with: {"selector": "", "selectorType": "css", "confidence": 0}
- Do NOT include any text outside the JSON object`;
}

/**
 * Builds the user prompt for a specific element mapping request.
 */
export function buildElementMappingUserPrompt(
  instruction: string,
  domContext: string,
  pageUrl: string,
): string {
  return `Instruction: ${instruction}

Page URL: ${pageUrl}

Page DOM:
${domContext}`;
}
