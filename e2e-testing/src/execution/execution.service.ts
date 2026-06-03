import {
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TestCasesService } from '../test-cases/test-cases.service';
import { ExecutionResponse } from './dto/execution-response.dto';

/**
 * Maximum number of pending + active jobs allowed in the queue.
 * Returns 429 when this threshold is reached.
 */
const MAX_QUEUE_DEPTH = 20;

/**
 * Service responsible for enqueuing test execution jobs into BullMQ.
 * Validates test case existence, checks queue capacity, and transitions
 * test case status to "queued" upon successful enqueue.
 *
 * Requirements: 2.1, 2.3, 2.5, 2.6
 */
@Injectable()
export class ExecutionService {
  constructor(
    @InjectQueue('test-execution') private readonly queue: Queue,
    private readonly testCasesService: TestCasesService,
  ) {}

  /**
   * Enqueues a test case for execution.
   *
   * @param testCaseId - The UUID of the test case to execute
   * @returns The BullMQ job ID
   * @throws NotFoundException if the test case does not exist
   * @throws HttpException 429 if queue depth >= 20
   * @throws HttpException 503 if Redis is unavailable
   */
  async enqueue(testCaseId: string): Promise<ExecutionResponse> {
    // 1. Validate test case exists
    const testCase = this.testCasesService.findOne(testCaseId);
    if (!testCase) {
      throw new NotFoundException(`Test case with id "${testCaseId}" not found`);
    }

    try {
      // 2. Check queue depth (waiting + active)
      const waitingCount = await this.queue.getWaitingCount();
      const activeCount = await this.queue.getActiveCount();
      const depth = waitingCount + activeCount;

      if (depth >= MAX_QUEUE_DEPTH) {
        throw new HttpException(
          'Maximum queue capacity reached',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 3. Parse instructions into array (split by newlines, filter empty)
      const instructions = testCase.instructions
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // 4. Add job to queue
      const job = await this.queue.add('execute-test', {
        testCaseId: testCase.id,
        instructions,
        targetUrl: testCase.targetUrl,
        triggeredBy: 'api',
        triggeredAt: new Date().toISOString(),
      });

      // 5. Transition test case status to "queued"
      this.testCasesService.updateStatus(testCaseId, 'queued');

      return { jobId: job.id! };
    } catch (error) {
      // Re-throw known HTTP exceptions
      if (error instanceof HttpException) {
        throw error;
      }

      // Handle Redis connection errors
      throw new HttpException(
        'Job queue is not reachable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
