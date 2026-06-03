import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TestCasesController } from '../../src/test-cases/test-cases.controller';
import { TestCasesService } from '../../src/test-cases/test-cases.service';

describe('TestCasesController', () => {
  let controller: TestCasesController;
  let service: TestCasesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestCasesController],
      providers: [TestCasesService],
    }).compile();

    controller = module.get<TestCasesController>(TestCasesController);
    service = module.get<TestCasesService>(TestCasesService);
  });

  describe('findAll', () => {
    it('should return an empty array when no test cases exist', () => {
      const result = controller.findAll();
      expect(result).toEqual([]);
    });

    it('should return all test cases', () => {
      service.create({ name: 'Test 1', instructions: 'Click login', targetUrl: 'http://localhost:3000' });
      service.create({ name: 'Test 2', instructions: 'Fill form', targetUrl: 'http://localhost:3000' });

      const result = controller.findAll();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Test 1');
      expect(result[1].name).toBe('Test 2');
    });
  });

  describe('create', () => {
    it('should create a test case and return it with status idle', () => {
      const dto = { name: 'Login Test', instructions: 'Click the login button', targetUrl: 'http://localhost:3000' };
      const result = controller.create(dto);

      expect(result.id).toBeDefined();
      expect(result.name).toBe('Login Test');
      expect(result.instructions).toBe('Click the login button');
      expect(result.targetUrl).toBe('http://localhost:3000');
      expect(result.status).toBe('idle');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('should return a test case by id', () => {
      const created = service.create({ name: 'Test', instructions: 'Do something', targetUrl: 'http://localhost:3000' });
      const result = controller.findOne(created.id);

      expect(result).toEqual(created);
    });

    it('should throw NotFoundException when test case does not exist', () => {
      expect(() => controller.findOne('non-existent-id')).toThrow(NotFoundException);
    });

    it('should include descriptive message in NotFoundException', () => {
      try {
        controller.findOne('abc-123');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).message).toContain('abc-123');
      }
    });
  });

  describe('delete', () => {
    it('should delete an existing test case', () => {
      const created = service.create({ name: 'Test', instructions: 'Do something', targetUrl: 'http://localhost:3000' });
      expect(() => controller.delete(created.id)).not.toThrow();

      // Verify it's gone
      expect(service.findOne(created.id)).toBeUndefined();
    });

    it('should throw NotFoundException when deleting non-existent test case', () => {
      expect(() => controller.delete('non-existent-id')).toThrow(NotFoundException);
    });
  });
});
