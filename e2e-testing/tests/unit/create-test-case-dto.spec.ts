import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateTestCaseDto } from '@/test-cases/dto/create-test-case.dto';

function createDto(overrides: Partial<CreateTestCaseDto> = {}): CreateTestCaseDto {
  const dto = new CreateTestCaseDto();
  dto.name = overrides.name ?? 'Login Test';
  dto.instructions = overrides.instructions ?? 'Click the login button';
  dto.targetUrl = overrides.targetUrl ?? 'https://app.clinicoz.com';
  return dto;
}

describe('CreateTestCaseDto', () => {
  describe('valid DTOs', () => {
    it('passes validation with all valid fields', async () => {
      const dto = createDto();
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('passes with instructions at max length (5000 chars)', async () => {
      const dto = createDto({ instructions: 'a'.repeat(5000) });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('name validation', () => {
    it('fails when name is empty', async () => {
      const dto = createDto({ name: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('name');
    });
  });

  describe('instructions validation', () => {
    it('fails when instructions are whitespace-only', async () => {
      const dto = createDto({ instructions: '   \t\n  ' });
      const errors = await validate(dto);
      const instructionErrors = errors.filter(e => e.property === 'instructions');
      expect(instructionErrors.length).toBeGreaterThan(0);
    });

    it('fails when instructions exceed 5000 characters', async () => {
      const dto = createDto({ instructions: 'x'.repeat(5001) });
      const errors = await validate(dto);
      const instructionErrors = errors.filter(e => e.property === 'instructions');
      expect(instructionErrors.length).toBeGreaterThan(0);
    });
  });

  describe('targetUrl validation', () => {
    it('fails when targetUrl is not a valid URL', async () => {
      const dto = createDto({ targetUrl: 'not-a-url' });
      const errors = await validate(dto);
      const urlErrors = errors.filter(e => e.property === 'targetUrl');
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('fails when targetUrl is empty', async () => {
      const dto = createDto({ targetUrl: '' });
      const errors = await validate(dto);
      const urlErrors = errors.filter(e => e.property === 'targetUrl');
      expect(urlErrors.length).toBeGreaterThan(0);
    });

    it('passes with http URL', async () => {
      const dto = createDto({ targetUrl: 'http://localhost:3000' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
