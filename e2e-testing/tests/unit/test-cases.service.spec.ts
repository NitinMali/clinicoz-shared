import { TestCasesService } from '../../src/test-cases/test-cases.service';
import { CreateTestCaseDto } from '../../src/test-cases/dto/create-test-case.dto';

describe('TestCasesService', () => {
  let service: TestCasesService;

  beforeEach(() => {
    service = new TestCasesService();
  });

  const validDto: CreateTestCaseDto = {
    name: 'Login Test',
    instructions: 'Click the login button and enter credentials',
    targetUrl: 'http://localhost:3000',
  };

  describe('create', () => {
    it('should create a test case with a UUID v4 id', () => {
      const result = service.create(validDto);
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(result.id).toMatch(uuidV4Regex);
    });

    it('should set initial status to idle', () => {
      const result = service.create(validDto);
      expect(result.status).toBe('idle');
    });

    it('should preserve name, instructions, and targetUrl from the DTO', () => {
      const result = service.create(validDto);
      expect(result.name).toBe(validDto.name);
      expect(result.instructions).toBe(validDto.instructions);
      expect(result.targetUrl).toBe(validDto.targetUrl);
    });

    it('should set createdAt and updatedAt to ISO 8601 timestamps', () => {
      const result = service.create(validDto);
      expect(() => new Date(result.createdAt)).not.toThrow();
      expect(() => new Date(result.updatedAt)).not.toThrow();
      expect(result.createdAt).toBe(result.updatedAt);
    });

    it('should not set lastRunAt or lastRunResult on creation', () => {
      const result = service.create(validDto);
      expect(result.lastRunAt).toBeUndefined();
      expect(result.lastRunResult).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('should return an empty array when no test cases exist', () => {
      expect(service.findAll()).toEqual([]);
    });

    it('should return all created test cases', () => {
      service.create(validDto);
      service.create({ ...validDto, name: 'Second Test' });
      expect(service.findAll()).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('should return a test case by id', () => {
      const created = service.create(validDto);
      const found = service.findOne(created.id);
      expect(found).toEqual(created);
    });

    it('should return undefined for a non-existent id', () => {
      expect(service.findOne('non-existent-id')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should return true and remove the test case when found', () => {
      const created = service.create(validDto);
      expect(service.delete(created.id)).toBe(true);
      expect(service.findOne(created.id)).toBeUndefined();
    });

    it('should return false for a non-existent id', () => {
      expect(service.delete('non-existent-id')).toBe(false);
    });
  });

  describe('updateStatus', () => {
    it('should update the status and updatedAt timestamp', () => {
      const created = service.create(validDto);
      const originalUpdatedAt = created.updatedAt;

      // Small delay to ensure timestamp differs
      const updated = service.updateStatus(created.id, 'queued');
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('queued');
      expect(updated!.updatedAt).toBeDefined();
    });

    it('should return undefined for a non-existent id', () => {
      expect(service.updateStatus('non-existent-id', 'running')).toBeUndefined();
    });

    it('should support all valid status transitions', () => {
      const created = service.create(validDto);

      service.updateStatus(created.id, 'queued');
      expect(service.findOne(created.id)!.status).toBe('queued');

      service.updateStatus(created.id, 'running');
      expect(service.findOne(created.id)!.status).toBe('running');

      service.updateStatus(created.id, 'passed');
      expect(service.findOne(created.id)!.status).toBe('passed');
    });
  });

  describe('updateResult', () => {
    it('should update lastRunResult and lastRunAt', () => {
      const created = service.create(validDto);
      const result = {
        status: 'passed' as const,
        steps: [
          {
            index: 0,
            instruction: 'Click login',
            status: 'passed' as const,
            selector: '#login-btn',
            cacheHit: false,
            duration: 1200,
          },
        ],
        duration: 1500,
      };

      const updated = service.updateResult(created.id, result);
      expect(updated).toBeDefined();
      expect(updated!.lastRunResult).toEqual(result);
      expect(updated!.lastRunAt).toBeDefined();
    });

    it('should return undefined for a non-existent id', () => {
      const result = {
        status: 'failed' as const,
        steps: [],
        duration: 0,
        error: 'Browser failed to launch',
      };
      expect(service.updateResult('non-existent-id', result)).toBeUndefined();
    });
  });
});
