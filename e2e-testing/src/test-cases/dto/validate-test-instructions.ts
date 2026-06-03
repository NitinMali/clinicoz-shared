/**
 * Validates test instructions for the E2E testing engine.
 *
 * Rules:
 * - Must contain at least 1 non-whitespace character
 * - Total length must not exceed 5000 characters
 *
 * This function is exported as a standalone utility for reuse
 * in property-based tests and other validation contexts.
 */
export function validateTestInstructions(
  input: string,
): { valid: true } | { valid: false; reason: string } {
  if (input.length === 0) {
    return { valid: false, reason: 'instructions must not be empty' };
  }

  if (input.length > 5000) {
    return {
      valid: false,
      reason: `instructions must not exceed 5000 characters (received ${input.length})`,
    };
  }

  if (input.trim().length === 0) {
    return {
      valid: false,
      reason: 'instructions must contain at least one non-whitespace character',
    };
  }

  return { valid: true };
}
