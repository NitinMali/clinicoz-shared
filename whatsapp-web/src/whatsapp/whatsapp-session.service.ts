import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, LocalAuth } from 'whatsapp-web.js';
import Redis from 'ioredis';
import * as qrcode from 'qrcode';
import { ConnectionStatus } from './whatsapp.interfaces';
import { REDIS_KEYS, QR_TTL_SECONDS } from '../shared/constants';

const PUPPETEER_OPTS = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
  ],
};

// Default idle timeout: 10 minutes
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

@Injectable()
export class WhatsAppSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppSessionService.name);
  private readonly clients = new Map<string, Client>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastActivity = new Map<string, Date>();
  private readonly idleTimeoutMs: number;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.idleTimeoutMs = this.configService.get<number>(
      'SESSION_IDLE_TIMEOUT_MS',
    ) || DEFAULT_IDLE_TIMEOUT_MS;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `Session idle timeout: ${this.idleTimeoutMs / 1000}s`,
    );
    await this.restoreAllSessions();
  }

  async onModuleDestroy(): Promise<void> {
    // Clear all idle timers on shutdown
    for (const [, timer] of this.idleTimers) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
  }

  // ── Idle timeout management ──

  /**
   * Resets the idle timer for a customer. After the timeout,
   * the Chromium process is destroyed but the session stays valid on disk.
   * Status remains "connected" in Redis — the browser is just sleeping.
   */
  private resetIdleTimer(customerId: string): void {
    // Clear existing timer
    const existing = this.idleTimers.get(customerId);
    if (existing) clearTimeout(existing);

    // Track last activity
    this.lastActivity.set(customerId, new Date());

    const timer = setTimeout(async () => {
      this.idleTimers.delete(customerId);
      const client = this.clients.get(customerId);
      if (!client) return;

      this.logger.log(
        `Idle timeout reached for customer ${customerId} — sleeping browser to save memory`,
      );

      try {
        await client.destroy();
      } catch (e) { /* ignore */ }
      this.clients.delete(customerId);
      // Status stays "connected" — session is valid, browser is just sleeping
    }, this.idleTimeoutMs);

    this.idleTimers.set(customerId, timer);
  }

  private clearIdleTimer(customerId: string): void {
    const timer = this.idleTimers.get(customerId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(customerId);
    }
  }

  // ── Wake up a sleeping session ──

  /**
   * Ensures a Chromium browser is running for the customer.
   * If the browser was put to sleep by idle timeout, this wakes it up
   * by re-launching from the saved LocalAuth session (no QR scan needed).
   */
  async ensureClientReady(customerId: string): Promise<Client> {
    // Already awake
    const existing = this.clients.get(customerId);
    if (existing) {
      this.resetIdleTimer(customerId);
      return existing;
    }

    // Check if session is valid (status = connected)
    const status = await this.redis.get(REDIS_KEYS.STATUS(customerId));
    if (status !== ConnectionStatus.CONNECTED) {
      throw new NotFoundException(`No active session for customer ${customerId}`);
    }

    // Wake up — re-launch browser from saved session
    this.logger.log(`Waking up sleeping session for customer ${customerId}...`);
    try {
      const client = await this.wakeUpClient(customerId);
      this.resetIdleTimer(customerId);
      return client;
    } catch (e) {
      // If browser lock conflict, wait briefly and retry once
      if (e.message?.includes('already running')) {
        this.logger.warn(`Browser lock conflict for ${customerId}, retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
        const retryClient = await this.wakeUpClient(customerId);
        this.resetIdleTimer(customerId);
        return retryClient;
      }
      throw e;
    }
  }

  private async wakeUpClient(customerId: string): Promise<Client> {
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: customerId }),
      puppeteer: PUPPETEER_OPTS,
    });

    client.on('ready', async () => {
      this.logger.log(`Session woken up for customer ${customerId}`);
    });

    client.on('auth_failure', async (msg) => {
      this.logger.error(`Wake-up auth failure for ${customerId}: ${msg}`);
      this.clients.delete(customerId);
      this.clearIdleTimer(customerId);
      await this.redis.set(REDIS_KEYS.STATUS(customerId), ConnectionStatus.DISCONNECTED);
    });

    client.on('disconnected', async (reason) => {
      this.logger.warn(`Customer ${customerId} disconnected after wake-up: ${reason}`);
      await this.redis.set(REDIS_KEYS.STATUS(customerId), ConnectionStatus.DISCONNECTED);
      this.clients.delete(customerId);
      this.clearIdleTimer(customerId);
    });

    await client.initialize();
    this.clients.set(customerId, client);
    return client;
  }

  // ── Connection initiation (async QR flow) ──

  async initiateConnection(customerId: string, allowedPhone?: string): Promise<void> {
    const existingStatus = await this.redis.get(REDIS_KEYS.STATUS(customerId));
    if (existingStatus === ConnectionStatus.CONNECTED && this.clients.has(customerId)) {
      throw new ConflictException('Customer already connected');
    }

    if (existingStatus === ConnectionStatus.AWAITING_SCAN && this.clients.has(customerId)) {
      return;
    }

    // Clean up any stale client
    if (this.clients.has(customerId)) {
      try { await this.clients.get(customerId).destroy(); } catch (e) { /* ignore */ }
      this.clients.delete(customerId);
    }
    this.clearIdleTimer(customerId);

    // Store the allowed phone number if provided
    if (allowedPhone) {
      const normalized = allowedPhone.replace(/[^0-9]/g, '');
      await this.redis.set(REDIS_KEYS.ALLOWED_PHONE(customerId), normalized);
    } else {
      await this.redis.del(REDIS_KEYS.ALLOWED_PHONE(customerId));
    }

    await this.redis.del(REDIS_KEYS.QR(customerId));
    await this.redis.set(REDIS_KEYS.STATUS(customerId), ConnectionStatus.AWAITING_SCAN);

    this.launchClient(customerId).catch((err) => {
      this.logger.error(`Background client launch failed for ${customerId}: ${err.message}`);
    });
  }

  async getQr(customerId: string): Promise<{ qrCode: string; qrImage: string } | null> {
    const qrRaw = await this.redis.get(REDIS_KEYS.QR(customerId));
    if (!qrRaw) return null;
    const qrImage = await qrcode.toDataURL(qrRaw);
    return { qrCode: qrRaw, qrImage };
  }

  private async launchClient(customerId: string): Promise<void> {
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: customerId }),
      puppeteer: PUPPETEER_OPTS,
    });

    this.clients.set(customerId, client);

    const timeout = setTimeout(async () => {
      // Only clean up if this client is still the active one (not replaced by a newer connection)
      if (this.clients.get(customerId) !== client) return;

      this.logger.warn(`QR generation timed out for customer ${customerId}`);
      try { await client.destroy(); } catch (e) { /* ignore */ }
      this.clients.delete(customerId);
      await this.redis.set(REDIS_KEYS.STATUS(customerId), ConnectionStatus.DISCONNECTED);
      await this.redis.del(REDIS_KEYS.QR(customerId));
    }, 90000);

    client.on('qr', async (qr: string) => {
      clearTimeout(timeout);
      this.logger.log(`QR code generated for customer ${customerId}`);
      await this.redis.set(REDIS_KEYS.QR(customerId), qr, 'EX', QR_TTL_SECONDS);
    });

    client.on('auth_failure', async (msg) => {
      clearTimeout(timeout);
      this.logger.error(`Auth failure for ${customerId}: ${msg}`);
      if (this.clients.get(customerId) === client) {
        try { await client.destroy(); } catch (e) { /* ignore */ }
        this.clients.delete(customerId);
      }
      this.clearIdleTimer(customerId);
      await this.redis.set(REDIS_KEYS.STATUS(customerId), ConnectionStatus.DISCONNECTED);
      await this.redis.del(REDIS_KEYS.QR(customerId));
    });

    client.on('ready', async () => {
      // Validate the scanned phone number against the allowed number
      const allowedPhone = await this.redis.get(REDIS_KEYS.ALLOWED_PHONE(customerId));
      if (allowedPhone) {
        const authenticatedPhone = client.info?.wid?.user;
        this.logger.log(
          `Phone validation for ${customerId}: allowed=${allowedPhone}, authenticated=${authenticatedPhone}`,
        );
        if (authenticatedPhone) {
          // Compare: check if one ends with the other (handles country code prefix differences)
          const match = allowedPhone === authenticatedPhone
            || allowedPhone.endsWith(authenticatedPhone)
            || authenticatedPhone.endsWith(allowedPhone);

          if (!match) {
            this.logger.warn(
              `Phone mismatch for customer ${customerId}: ` +
              `expected ${allowedPhone}, got ${authenticatedPhone}. Disconnecting.`,
            );
            try {
              await client.logout();
              this.logger.log(`Logout successful for mismatched phone ${authenticatedPhone}`);
            } catch (e) {
              this.logger.error(`Logout failed for ${customerId}: ${e.message}`);
            }
            try { await client.destroy(); } catch (e) { /* ignore */ }
            this.clients.delete(customerId);
            await this.redis.set(REDIS_KEYS.STATUS(customerId), ConnectionStatus.DISCONNECTED);
            await this.redis.del(REDIS_KEYS.QR(customerId));
            return;
          }
        }
      }

      this.logger.log(`Customer ${customerId} connected successfully`);
      await this.redis.set(REDIS_KEYS.STATUS(customerId), ConnectionStatus.CONNECTED);
      await this.redis.del(REDIS_KEYS.QR(customerId));
      // Start idle timer after successful connection
      this.resetIdleTimer(customerId);
    });

    client.on('disconnected', async (reason) => {
      this.logger.warn(`Customer ${customerId} disconnected: ${reason}`);
      if (this.clients.get(customerId) === client) {
        this.clients.delete(customerId);
        this.clearIdleTimer(customerId);
      }
      await this.redis.set(REDIS_KEYS.STATUS(customerId), ConnectionStatus.DISCONNECTED);
      await this.redis.del(REDIS_KEYS.QR(customerId));
    });

    await client.initialize();
  }

  // ── Session restore, getClient, disconnect, getStatus ──

  async restoreAllSessions(): Promise<void> {
    let cursor = '0';
    const customerIds: string[] = [];

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor, 'MATCH', REDIS_KEYS.STATUS_PATTERN, 'COUNT', 100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const value = await this.redis.get(key);
        if (value === ConnectionStatus.CONNECTED) {
          const customerId = key.replace('whatsapp:status:', '');
          customerIds.push(customerId);
        }
      }
    } while (cursor !== '0');

    if (customerIds.length === 0) return;

    // Don't eagerly restore all sessions — just log them.
    // They'll be woken up on demand when a message needs to be sent.
    this.logger.log(
      `Found ${customerIds.length} connected session(s) in Redis. ` +
      `They will be woken up on demand (lazy restore).`,
    );
  }

  /**
   * Returns the in-memory Client if awake. Throws if not found.
   * For message sending, use ensureClientReady() instead — it wakes sleeping sessions.
   */
  getClient(customerId: string): Client {
    const client = this.clients.get(customerId);
    if (!client) {
      throw new NotFoundException(`No active session for customer ${customerId}`);
    }
    return client;
  }

  async disconnect(customerId: string): Promise<void> {
    this.clearIdleTimer(customerId);

    let client = this.clients.get(customerId);

    // If browser is sleeping, wake it up so we can properly logout from WhatsApp
    if (!client) {
      const status = await this.redis.get(REDIS_KEYS.STATUS(customerId));
      if (status === ConnectionStatus.CONNECTED) {
        try {
          this.logger.log(`Waking up session for ${customerId} to perform logout...`);
          client = await this.wakeUpClient(customerId);
        } catch (e) {
          this.logger.warn(`Could not wake session for logout: ${e.message}`);
        }
      } else if (!status) {
        throw new NotFoundException(`No active session for customer ${customerId}`);
      }
    }

    if (client) {
      try { await client.logout(); } catch (e) { /* ignore */ }
      try { await client.destroy(); } catch (e) { /* ignore */ }
      this.clients.delete(customerId);
    }

    await this.redis.del(
      REDIS_KEYS.SESSION(customerId),
      REDIS_KEYS.QR(customerId),
      REDIS_KEYS.STATUS(customerId),
      REDIS_KEYS.ALLOWED_PHONE(customerId),
    );
  }

  async getStatus(customerId: string): Promise<ConnectionStatus> {
    const status = await this.redis.get(REDIS_KEYS.STATUS(customerId));
    if (!status) {
      throw new NotFoundException(`No session found for customer ${customerId}`);
    }
    return status as ConnectionStatus;
  }

  /**
   * Returns whether the browser is currently running for this customer.
   */
  isBrowserAwake(customerId: string): boolean {
    return this.clients.has(customerId);
  }

  /**
   * Lightweight stats for the health endpoint. No heavy computation.
   */
  async getStats(): Promise<{
    uptime: number;
    memory: { rss: string; heapUsed: string; heapTotal: string };
    sessions: {
      totalConnected: number;
      browsersAwake: number;
      browsersSleeping: number;
      customers: Array<{
        customerId: string;
        browserState: 'awake' | 'sleeping';
        lastActivity: string | null;
      }>;
    };
    idleTimeoutMs: number;
  }> {
    // Count connected sessions from Redis
    let cursor = '0';
    const connectedCustomers: string[] = [];

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor, 'MATCH', REDIS_KEYS.STATUS_PATTERN, 'COUNT', 100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const value = await this.redis.get(key);
        if (value === ConnectionStatus.CONNECTED) {
          connectedCustomers.push(key.replace('whatsapp:status:', ''));
        }
      }
    } while (cursor !== '0');

    const mem = process.memoryUsage();
    const toMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

    const customers = connectedCustomers.map((id) => ({
      customerId: id,
      browserState: (this.clients.has(id) ? 'awake' : 'sleeping') as 'awake' | 'sleeping',
      lastActivity: this.lastActivity.get(id)?.toISOString() || null,
    }));

    return {
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: toMB(mem.rss),
        heapUsed: toMB(mem.heapUsed),
        heapTotal: toMB(mem.heapTotal),
      },
      sessions: {
        totalConnected: connectedCustomers.length,
        browsersAwake: this.clients.size,
        browsersSleeping: connectedCustomers.length - this.clients.size,
        customers,
      },
      idleTimeoutMs: this.idleTimeoutMs,
    };
  }
}
