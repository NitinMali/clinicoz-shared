import { NotFoundException } from '@nestjs/common';
import { ExecutionController } from '../../src/execution/execution.controller';
import { ExecutionService } from '../../src/execution/execution.service';
import { TestCasesService } from '../../src/test-cases/test-cases.service';

describe('ExecutionController', () => {
  let controller: ExecutionController;
  let executionService: ExecutionService;
  let testCasesService: TestCasesService;
  let mockQueue: any;

  beforeEach(() => {
    testCasesService = new TestCasesService();

    mockQueue = {
      getWaitingCount: jest.fn().mockResolvedValue(0),
      getActiveCount: jest.fn().mockResolvedValue(0),
      add: jest.fn().mockResolvedValue({ id: 'job-uuid-123' }),
      getJob: jest.fn(),
    };

    executionService = new ExecutionService(mockQueue, testCasesService);
    controller = new ExecutionController(executionService, mockQueue);
  });

  describe('POST /api/test-cases/:id/execute', () => {
    it('should return jobId on successful enqueue', async () => {
      const testCase = testCasesService.create({
        name: 'Login Test',
        instructions: 'Click login button',
        targetUrl: 'http://localhost:3000',
      });

      const result = await controller.execute(testCase.id);

      expect(result).toEqual({ jobId: 'job-uuid-123' });
    });

    it('should throw NotFoundException for non-existent test case', async () => {
      await expect(controller.execute('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('GET /api/jobs/:jobId', () => {
    it('should return job status when job exists', async () => {
      const mockJob = {
        id: 'job-uuid-123',
        progress: 50,
        getState: jest.fn().mockResolvedValue('active'),
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await controller.getJobStatus('job-uuid-123');

      expect(result).toEqual({
        jobId: 'job-uuid-123',
        state: 'active',
        progress: 50,
      });
      expect(mockQueue.getJob).toHaveBeenCalledWith('job-uuid-123');
    });

    it('should throw NotFoundException when job does not exist', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      await expect(controller.getJobStatus('non-existent-job')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return completed state for finished jobs', async () => {
      const mockJob = {
        id: 'job-uuid-456',
        progress: 100,
        getState: jest.fn().mockResolvedValue('completed'),
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await controller.getJobStatus('job-uuid-456');

      expect(result).toEqual({
        jobId: 'job-uuid-456',
        state: 'completed',
        progress: 100,
      });
    });

    it('should return waiting state for queued jobs', async () => {
      const mockJob = {
        id: 'job-uuid-789',
        progress: 0,
        getState: jest.fn().mockResolvedValue('waiting'),
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await controller.getJobStatus('job-uuid-789');

      expect(result).toEqual({
        jobId: 'job-uuid-789',
        state: 'waiting',
        progress: 0,
      });
    });

    it('should return failed state for failed jobs', async () => {
      const mockJob = {
        id: 'job-failed-1',
        progress: 30,
        getState: jest.fn().mockResolvedValue('failed'),
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await controller.getJobStatus('job-failed-1');

      expect(result).toEqual({
        jobId: 'job-failed-1',
        state: 'failed',
        progress: 30,
      });
    });
  });
});
