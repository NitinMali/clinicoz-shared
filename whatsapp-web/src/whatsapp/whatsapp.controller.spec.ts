import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { ConnectionStatus } from './whatsapp.interfaces';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('WhatsAppController', () => {
  let controller: WhatsAppController;
  let sessionService: jest.Mocked<Partial<WhatsAppSessionService>>;

  beforeEach(async () => {
    sessionService = {
      initiateConnection: jest.fn(),
      getStatus: jest.fn(),
      disconnect: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsAppController],
      providers: [
        { provide: WhatsAppSessionService, useValue: sessionService },
      ],
    }).compile();

    controller = module.get<WhatsAppController>(WhatsAppController);
  });

  describe('POST /connect/:customerId', () => {
    it('should return ConnectResponse with QR code and awaiting_scan status', async () => {
      sessionService.initiateConnection.mockResolvedValue('qr-data-base64');

      const result = await controller.connect('cust_123');

      expect(result).toEqual({
        customerId: 'cust_123',
        qrCode: 'qr-data-base64',
        status: ConnectionStatus.AWAITING_SCAN,
      });
      expect(sessionService.initiateConnection).toHaveBeenCalledWith('cust_123');
    });

    it('should propagate 409 ConflictException when already connected', async () => {
      sessionService.initiateConnection.mockRejectedValue(
        new ConflictException('Customer already connected'),
      );

      await expect(controller.connect('cust_123')).rejects.toThrow(ConflictException);
    });
  });

  describe('GET /status/:customerId', () => {
    it('should return StatusResponse with current status', async () => {
      sessionService.getStatus.mockResolvedValue(ConnectionStatus.CONNECTED);

      const result = await controller.getStatus('cust_123');

      expect(result).toEqual({
        customerId: 'cust_123',
        status: ConnectionStatus.CONNECTED,
      });
      expect(sessionService.getStatus).toHaveBeenCalledWith('cust_123');
    });

    it('should propagate 404 NotFoundException when no status exists', async () => {
      sessionService.getStatus.mockRejectedValue(
        new NotFoundException('No session found for customer'),
      );

      await expect(controller.getStatus('cust_123')).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /disconnect/:customerId', () => {
    it('should return StatusResponse with disconnected status', async () => {
      sessionService.disconnect.mockResolvedValue(undefined);

      const result = await controller.disconnect('cust_123');

      expect(result).toEqual({
        customerId: 'cust_123',
        status: ConnectionStatus.DISCONNECTED,
      });
      expect(sessionService.disconnect).toHaveBeenCalledWith('cust_123');
    });

    it('should propagate 404 NotFoundException when no active session', async () => {
      sessionService.disconnect.mockRejectedValue(
        new NotFoundException('No active session for customer'),
      );

      await expect(controller.disconnect('cust_123')).rejects.toThrow(NotFoundException);
    });
  });
});
