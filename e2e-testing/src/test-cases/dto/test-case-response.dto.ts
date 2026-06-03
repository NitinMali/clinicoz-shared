/**
 * Represents the execution result of a test case.
 */
export interface TestExecutionResult {
  status: 'passed' | 'failed';
  steps: StepResult[];
  duration: number;
  error?: string;
}

export interface StepResult {
  index: number;
  instruction: string;
  status: 'passed' | 'failed';
  selector?: string;
  cacheHit: boolean;
  duration: number;
  error?: string;
  screenshot?: string; // filename of screenshot on failure (e.g., "step-3-1719500000.png")
}

/**
 * Status values a test case can have throughout its lifecycle.
 */
export type TestCaseStatus = 'idle' | 'queued' | 'running' | 'passed' | 'failed';

/**
 * Response DTO representing a persisted test case.
 * Matches the TestCase data model from the design document.
 */
export interface TestCaseResponse {
  /** UUID v4 identifier */
  id: string;
  /** Display name for the test case */
  name: string;
  /** Plain-English test instructions (1-5000 chars) */
  instructions: string;
  /** URL of the application to test */
  targetUrl: string;
  /** Current execution status */
  status: TestCaseStatus;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
  /** ISO 8601 timestamp of last execution (optional) */
  lastRunAt?: string;
  /** Result of the last execution (optional) */
  lastRunResult?: TestExecutionResult;
}
