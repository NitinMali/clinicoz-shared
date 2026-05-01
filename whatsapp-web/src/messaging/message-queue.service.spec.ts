import { ConflictException } from '@nestjs/common';
import { MessageQueueService } from './message-queue.service';
import { ConnectionStatus } from '../whatsapp/whatsapp.interfaces';
import { REDIS_KEYS } from '../shared/constants';
import { SendMessageDto } from '../shared/dto/send-message.dto';

describe('MessageQueueService', () => {
  let service: MessageQueueService;
  let mockQueue: { add: jest.Mock };
  let mockRedis: { get: jest.Mock };

  beforeEach(() => {
    mockQueue = { add: jest.fn() };
    mockRedis = { get: jest.fn() };
    service = new MessageQueueService(mockQueue as any, mockRedis as any);
  });

  const createDto = (overrides?: Partial<SendMessageDto>): SendMessageDto => ({
    customerId: 'cust_123',
    phone: '911234567890',
    message: 'Hello!',
    ...overrides,
  });

  describe('enqueue', () => {
    it('should enqueue a message and return the job ID when customer is connected', async () => {
      mockRedis.get.mockResolvedValue(ConnectionStatus.CONNECTED);
      mockQueue.add.mockResolvedValue({ id: 'job_abc123' });

      const dto = createDto();
      const jobId = await service.enqueue(dto);

      expect(jobId).toBe('job_abc123');
      expect(mockRedis.get).toHaveBeenCalledWith(REDIS_KEYS.STATUS('cust_123'));
      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-message',
        {
          customerId: 'cust_123',
          phone: '911234567890',
          message: 'Hello!',
          mediaUrl: undefined,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    });

    it('should include mediaUrl in the job payload when provided', async () => {
      mockRedis.get.mockResolvedValue(ConnectionStatus.CONNECTED);
      mockQueue.add.mockResolvedValue({ id: 'job_media' });

      const dto = createDto({ mediaUrl: 'https://example.com/image.png' });
      await service.enqueue(dto);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-message',
        expect.objectContaining({ mediaUrl: 'https://example.com/image.png' }),
        expect.any(Object),
      );
    });

    it('should throw ConflictException when customer status is disconnected', async () => {
      mockRedis.get.mockResolvedValue(ConnectionStatus.DISCONNECTED);

      await expect(service.enqueue(createDto())).rejects.toThrow(ConflictException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when customer status is awaiting_scan', async () => {
      mockRedis.get.mockResolvedValue(ConnectionStatus.AWAITING_SCAN);

      await expect(service.enqueue(createDto())).rejects.toThrow(ConflictException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when no status exists (null)', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.enqueue(createDto())).rejects.toThrow(ConflictException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should throw ConflictException with descriptive message', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.enqueue(createDto())).rejects.toThrow('Customer is not connected');
    });
  });
});
