import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { CreateTestCaseDto } from './dto/create-test-case.dto';
import {
  TestCaseResponse,
  TestCaseStatus,
  TestExecutionResult,
} from './dto/test-case-response.dto';

const DATA_FILE = path.resolve(process.cwd(), 'data', 'test-cases.json');

/**
 * Service managing test case CRUD operations with file-based persistence.
 * Uses a Map<string, TestCaseResponse> in memory, backed by a JSON file on disk.
 * Status transitions: idle → queued → running → passed/failed
 */
@Injectable()
export class TestCasesService {
  private readonly logger = new Logger(TestCasesService.name);
  private readonly testCases = new Map<string, TestCaseResponse>();

  constructor() {
    this.loadFromDisk();
  }

  /**
   * Creates a new test case with a generated UUID v4 and initial status 'idle'.
   */
  create(dto: CreateTestCaseDto): TestCaseResponse {
    const now = new Date().toISOString();
    const testCase: TestCaseResponse = {
      id: uuidv4(),
      name: dto.name,
      instructions: dto.instructions,
      targetUrl: dto.targetUrl,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };

    this.testCases.set(testCase.id, testCase);
    this.saveToDisk();
    return testCase;
  }

  /**
   * Returns all stored test cases.
   */
  findAll(): TestCaseResponse[] {
    return Array.from(this.testCases.values());
  }

  /**
   * Returns a single test case by ID, or undefined if not found.
   */
  findOne(id: string): TestCaseResponse | undefined {
    return this.testCases.get(id);
  }

  /**
   * Updates a test case's name, instructions, and targetUrl. Returns the updated test case or undefined if not found.
   */
  update(id: string, dto: CreateTestCaseDto): TestCaseResponse | undefined {
    const testCase = this.testCases.get(id);
    if (!testCase) {
      return undefined;
    }

    testCase.name = dto.name;
    testCase.instructions = dto.instructions;
    testCase.targetUrl = dto.targetUrl;
    testCase.updatedAt = new Date().toISOString();
    this.saveToDisk();
    return testCase;
  }

  /**
   * Deletes a test case by ID. Returns true if found and removed, false otherwise.
   */
  delete(id: string): boolean {
    const result = this.testCases.delete(id);
    if (result) this.saveToDisk();
    return result;
  }

  /**
   * Updates the status of a test case. Returns the updated test case or undefined if not found.
   */
  updateStatus(id: string, status: TestCaseStatus): TestCaseResponse | undefined {
    const testCase = this.testCases.get(id);
    if (!testCase) {
      return undefined;
    }

    testCase.status = status;
    testCase.updatedAt = new Date().toISOString();
    this.saveToDisk();
    return testCase;
  }

  /**
   * Updates the last run result of a test case. Returns the updated test case or undefined if not found.
   */
  updateResult(id: string, result: TestExecutionResult): TestCaseResponse | undefined {
    const testCase = this.testCases.get(id);
    if (!testCase) {
      return undefined;
    }

    testCase.lastRunResult = result;
    testCase.lastRunAt = new Date().toISOString();
    testCase.updatedAt = testCase.lastRunAt;
    this.saveToDisk();
    return testCase;
  }

  /**
   * Loads test cases from disk. If the file doesn't exist or is corrupt, starts fresh.
   */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(DATA_FILE)) {
        this.logger.log('No existing test cases file found, starting fresh');
        return;
      }

      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data: TestCaseResponse[] = JSON.parse(raw);

      for (const tc of data) {
        // Reset running/queued statuses to idle on restart
        if (tc.status === 'running' || tc.status === 'queued') {
          tc.status = 'idle';
        }
        this.testCases.set(tc.id, tc);
      }

      this.logger.log(`Loaded ${data.length} test cases from disk`);
    } catch (error) {
      this.logger.warn(`Failed to load test cases from disk: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Persists all test cases to disk as JSON.
   */
  private saveToDisk(): void {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = Array.from(this.testCases.values());
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to save test cases to disk: ${error instanceof Error ? error.message : error}`);
    }
  }
}
