import { Controller, Post, Get, Param, HttpCode, Res, Body } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { ConnectionStatus } from './whatsapp.interfaces';
import { Public } from '../auth/public.decorator';

// Load static placeholder images once at startup
const inProgressBuffer = fs.readFileSync(
  path.join(__dirname, '..', 'qr-in-progress.png'),
);
const disconnectedBuffer = fs.readFileSync(
  path.join(__dirname, '..', 'qr-dis-connected.png'),
);

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly sessionService: WhatsAppSessionService) {}

  @Post('connect/:customerId')
  @HttpCode(202)
  async connect(
    @Param('customerId') customerId: string,
    @Body('allowedPhone') allowedPhone?: string,
  ) {
    await this.sessionService.initiateConnection(customerId, allowedPhone);
    return {
      customerId,
      status: ConnectionStatus.AWAITING_SCAN,
      qrUrl: `/whatsapp/connect/${customerId}/qr`,
      qrImageUrl: `/whatsapp/connect/${customerId}/qr/image`,
      statusUrl: `/whatsapp/status/${customerId}`,
      ...(allowedPhone && { allowedPhone, note: 'Only this phone number will be accepted.' }),
    };
  }

  @Get('connect/:customerId/qr')
  async getQr(@Param('customerId') customerId: string) {
    const status = await this.sessionService.getStatus(customerId);

    // Already connected — no QR needed
    if (status === ConnectionStatus.CONNECTED) {
      return { customerId, status: ConnectionStatus.CONNECTED, qrCode: null, qrImage: null };
    }

    // Not in awaiting_scan state
    if (status !== ConnectionStatus.AWAITING_SCAN) {
      return { customerId, status, qrCode: null, qrImage: null };
    }

    // Check if QR is ready in Redis
    const qr = await this.sessionService.getQr(customerId);
    if (!qr) {
      return {
        customerId,
        status: ConnectionStatus.AWAITING_SCAN,
        qrCode: null,
        qrImage: null,
        message: 'QR code is still being generated. Try again in a few seconds.',
      };
    }

    return {
      customerId,
      status: ConnectionStatus.AWAITING_SCAN,
      qrCode: qr.qrCode,
      qrImage: qr.qrImage,
    };
  }

  @Get('status/:customerId')
  async getStatus(@Param('customerId') customerId: string) {
    const status = await this.sessionService.getStatus(customerId);
    return { customerId, status };
  }

  @Get('admin/stats')
  async getStats() {
    return this.sessionService.getStats();
  }

  @Post('disconnect/:customerId')
  async disconnect(@Param('customerId') customerId: string) {
    await this.sessionService.disconnect(customerId);
    return { customerId, status: ConnectionStatus.DISCONNECTED };
  }

  @Public()
  @Get('connect/:customerId/qr/image')
  async getQrImage(
    @Param('customerId') customerId: string,
    @Res() res: Response,
  ) {
    let buffer: Buffer = disconnectedBuffer;
    let qrStatus = 'disconnected';

    try {
      const status = await this.sessionService.getStatus(customerId);
      if (status === ConnectionStatus.AWAITING_SCAN) {
        const qr = await this.sessionService.getQr(customerId);
        if (qr) {
          buffer = Buffer.from(qr.qrImage.replace(/^data:image\/png;base64,/, ''), 'base64');
          qrStatus = 'ready';
        } else {
          buffer = inProgressBuffer;
          qrStatus = 'in-progress';
        }
      } else if (status === ConnectionStatus.CONNECTED) {
        buffer = disconnectedBuffer;
        qrStatus = 'connected';
      }
    } catch (e) {
      // No session found — show disconnected image
    }

    res.set({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'X-QR-Status': qrStatus,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.send(buffer);
  }
}
