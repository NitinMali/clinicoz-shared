import { NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { ExecutionService } from '../../src/execution/execution.service';
import { TestCasesService } from '../../src/test-cases/test-cases.service';

describe('ExecutionService', () => {
  let service: ExecutionService;
  let testCasesService: TestCasesService;
  let mockQueue: any;

  beforeEach(() => {
    testCasesService = new TestCasesService();

    mockQueue = {
      getWaitingCount: jest.fn().mockResolvedValue(0),
      getActiveCount: jest.fn().mockResolvedValue(0),
      add: jest.fn().mockResolvedValue({ id: 'job-uuid-123' }),
    };

    service = new ExecutionService(mockQueue, testCasesService);
  });

  describe('enqueue', () => {
    it('should throw NotFoundException when test case does not exist', async () => {
      await expect(service.enqueue('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should enqueue a valid test case and return a job ID', async () => {
      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button\nEnter credentials',
        targetUrl: 'http://localhost:3000',
      });

      const result = await service.enqueue(testCase.id);

      expect(result.jobId).toBe('job-uuid-123');
      expect(mockQueue.add).toHaveBeenCalledWith('execute-test', {
        testCaseId: testCase.id,
        instructions: ['Click login button', 'Enter credentials'],
        targetUrl: 'http://localhost:3000',
        triggeredBy: 'api',
        triggeredAt: expect.any(String),
      });
    });

    it('should transition test case status to "queued" after enqueue', async () => {
      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button',
        targetUrl: 'http://localhost:3000',
      });

      await service.enqueue(testCase.id);

      const updated = testCasesService.findOne(testCase.id);
      expect(updated!.status).toBe('queued');
    });

    it('should throw 429 when queue depth is at maximum (20)', async () => {
      mockQueue.getWaitingCount.mockResolvedValue(15);
      mockQueue.getActiveCount.mockResolvedValue(5);

      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button',
        targetUrl: 'http://localhost:3000',
      });

      await expect(service.enqueue(testCase.id)).rejects.toThrow(
        new HttpException(
          'Maximum queue capacity reached',
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );
    });

    it('should throw 429 when queue depth exceeds maximum', async () => {
      mockQueue.getWaitingCount.mockResolvedValue(18);
      mockQueue.getActiveCount.mockResolvedValue(5);

      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button',
        targetUrl: 'http://localhost:3000',
      });

      await expect(service.enqueue(testCase.id)).rejects.toThrow(HttpException);

      try {
        await service.enqueue(testCase.id);
      } catch (e: any) {
        expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('should allow enqueue when queue depth is below maximum', async () => {
      mockQueue.getWaitingCount.mockResolvedValue(10);
      mockQueue.getActiveCount.mockResolvedValue(9);

      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button',
        targetUrl: 'http://localhost:3000',
      });

      const result = await service.enqueue(testCase.id);
      expect(result.jobId).toBe('job-uuid-123');
    });

    it('should throw 503 when Redis is unavailable', async () => {
      mockQueue.getWaitingCount.mockRejectedValue(
        new Error('Connection refused'),
      );

      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button',
        targetUrl: 'http://localhost:3000',
      });

      await expect(service.enqueue(testCase.id)).rejects.toThrow(HttpException);

      try {
        await service.enqueue(testCase.id);
      } catch (e: any) {
        expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(e.message).toBe('Job queue is not reachable');
      }
    });

    it('should parse multi-line instructions into an array', async () => {
      const testCase = testCasesService.create({
        name: 'Multi-step Test',
        instructions: 'Step 1: Navigate to login\n\nStep 2: Enter username\nStep 3: Click submit',
        targetUrl: 'http://localhost:3000',
      });

      await service.enqueue(testCase.id);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'execute-test',
        expect.objectContaining({
          instructions: [
            'Step 1: Navigate to login',
            'Step 2: Enter username',
            'Step 3: Click submit',
          ],
        }),
      );
    });

    it('should not change test case status when queue is full', async () => {
      mockQueue.getWaitingCount.mockResolvedValue(20);
      mockQueue.getActiveCount.mockResolvedValue(0);

      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button',
        targetUrl: 'http://localhost:3000',
      });

      try {
        await service.enqueue(testCase.id);
      } catch {
        // expected
      }

      const found = testCasesService.findOne(testCase.id);
      expect(found!.status).toBe('idle');
    });

    it('should not change test case status when Redis is unavailable', async () => {
      mockQueue.getWaitingCount.mockRejectedValue(
        new Error('Connection refused'),
      );

      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button',
        targetUrl: 'http://localhost:3000',
      });

      try {
        await service.enqueue(testCase.id);
      } catch {
        // expected
      }

      const found = testCasesService.findOne(testCase.id);
      expect(found!.status).toBe('idle');
    });
  });
});
