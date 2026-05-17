import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];
    const expectedKey = this.configService.get<string>('API_KEY');

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException();
    }

    if (!expectedKey) {
      throw new UnauthorizedException();
    }

    if (!this.isKeyValid(apiKey, expectedKey)) {
      throw new UnauthorizedException();
    }

    return true;
  }

  private isKeyValid(provided: string, expected: string): boolean {
    const providedBuf = Buffer.from(provided, 'utf-8');
    const expectedBuf = Buffer.from(expected, 'utf-8');

    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }

    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
