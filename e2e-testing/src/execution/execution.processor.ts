import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TestCasesService } from '../test-cases/test-cases.service';
import { TestExecutionResult } from '../test-cases/dto/test-case-response.dto';

/**
 * Payload structure for test execution jobs enqueued by ExecutionService.
 */
export interface TestExecutionPayload {
  testCaseId: string;
  instructions: string[];
  targetUrl: string;
  triggeredBy: string;
  triggeredAt: string;
}

/**
 * Interface for the AutomationService that will be implemented in task 8.3.
 * Used as the contract for the injection token.
 */
export interface IAutomationService {
  executeTestCase(payload: TestExecutionPayload): Promise<TestExecutionResult>;
}

/**
 * Injection token for the AutomationService.
 * The actual implementation will be provided when the AutomationModule is created.
 */
export const AUTOMATION_SERVICE = 'AUTOMATION_SERVICE';

/**
 * BullMQ processor for the 'test-execution' queue.
 * Enforces concurrency of 1 to ensure only one browser instance runs at a time,
 * preventing memory exhaustion on the EC2 t3.small instance (2 GB RAM).
 *
 * Requirements: 2.2, 4.1, 4.2, 4.3, 4.4, 7.1
 */
@Processor('test-execution', { concurrency: 1 })
export class ExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecutionProcessor.name);

  constructor(
    private readonly testCasesService: TestCasesService,
    @Inject(AUTOMATION_SERVICE)
    private readonly automationService: IAutomationService,
  ) {
    super();
  }

  /**
   * Processes a test execution job from the BullMQ queue.
   *
   * Flow:
   * 1. Update test case status to "running"
   * 2. Delegate execution to AutomationService
   * 3. Update test case status to "passed" or "failed" based on result
   * 4. Store execution result via testCasesService.updateResult()
   * 5. Return the TestExecutionResult
   *
   * @param job - The BullMQ job containing TestExecutionPayload
   * @returns The execution result with status, steps, and duration
   */
  async process(job: Job<TestExecutionPayload>): Promise<TestExecutionResult> {
    const { testCaseId, instructions, targetUrl, triggeredBy, triggeredAt } =
      job.data;

    this.logger.log(
      `Processing test case ${testCaseId} with ${instructions.length} instructions`,
    );

    // 1. Update test case status to "running"
    this.testCasesService.updateStatus(testCaseId, 'running');

    const startTime = Date.now();

    try {
      // 2. Delegate execution to AutomationService
      const result = await this.automationService.executeTestCase({
        testCaseId,
        instructions,
        targetUrl,
        triggeredBy,
        triggeredAt,
      });

      const duration = Date.now() - startTime;

      // Ensure duration is recorded from the processor's perspective
      const finalResult: TestExecutionResult = {
        ...result,
        duration,
      };

      // 3. Update test case status based on result
      this.testCasesService.updateStatus(testCaseId, finalResult.status);

      // 4. Store execution result
      this.testCasesService.updateResult(testCaseId, finalResult);

      this.logger.log(
        `Test case ${testCaseId} completed with status: ${finalResult.status} (${duration}ms)`,
      );

      // 5. Return the result
      return finalResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown execution error';

      this.logger.error(
        `Test case ${testCaseId} failed with error: ${errorMessage}`,
      );

      // Build a failed result
      const failedResult: TestExecutionResult = {
        status: 'failed',
        steps: [],
        duration,
        error: errorMessage,
      };

      // Update test case status to "failed"
      this.testCasesService.updateStatus(testCaseId, 'failed');

      // Store the failed result
      this.testCasesService.updateResult(testCaseId, failedResult);

      return failedResult;
    }
  }
}
