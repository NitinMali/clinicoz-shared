// Redis key patterns
export const REDIS_KEYS = {
  SESSION: (customerId: string) => `whatsapp:session:${customerId}`,
  STATUS: (customerId: string) => `whatsapp:status:${customerId}`,
  QR: (customerId: string) => `whatsapp:qr:${customerId}`,
  HISTORY: (customerId: string) => `whatsapp:history:${customerId}`,
  STATUS_PATTERN: 'whatsapp:status:*',
} as const;

// QR code TTL in seconds (2 minutes — WhatsApp rotates QR every ~20s, but we keep the latest)
export const QR_TTL_SECONDS = 120;

// BullMQ queue names
export const QUEUE_NAMES = {
  MESSAGES: 'whatsapp-messages',
  MESSAGES_DLQ: 'whatsapp-messages-dlq',
} as const;
