import { validateTestInstructions } from '@/test-cases/dto/validate-test-instructions';

describe('validateTestInstructions', () => {
  describe('valid inputs', () => {
    it('accepts a simple non-empty string', () => {
      const result = validateTestInstructions('Click the login button');
      expect(result).toEqual({ valid: true });
    });

    it('accepts a single character', () => {
      const result = validateTestInstructions('a');
      expect(result).toEqual({ valid: true });
    });

    it('accepts a string with leading/trailing whitespace but non-whitespace content', () => {
      const result = validateTestInstructions('  hello  ');
      expect(result).toEqual({ valid: true });
    });

    it('accepts a string at exactly 5000 characters', () => {
      const input = 'a'.repeat(5000);
      const result = validateTestInstructions(input);
      expect(result).toEqual({ valid: true });
    });

    it('accepts a string with mixed whitespace and content', () => {
      const result = validateTestInstructions('\t\n x \t\n');
      expect(result).toEqual({ valid: true });
    });
  });

  describe('invalid inputs', () => {
    it('rejects an empty string', () => {
      const result = validateTestInstructions('');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('empty');
      }
    });

    it('rejects a whitespace-only string (spaces)', () => {
      const result = validateTestInstructions('     ');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('non-whitespace');
      }
    });

    it('rejects a whitespace-only string (tabs and newlines)', () => {
      const result = validateTestInstructions('\t\n\r\n\t');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('non-whitespace');
      }
    });

    it('rejects a string exceeding 5000 characters', () => {
      const input = 'a'.repeat(5001);
      const result = validateTestInstructions(input);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('5000');
      }
    });

    it('rejects a very long whitespace-only string', () => {
      const input = ' '.repeat(100);
      const result = validateTestInstructions(input);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('non-whitespace');
      }
    });
  });
});
