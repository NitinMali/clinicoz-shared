# WhatsApp Microservice — Requirements Overview

## Summary

A standalone NestJS microservice that allows customers to link their personal WhatsApp number once and have messages sent automatically on their behalf based on event triggers. Built to run as an independent EC2 instance and consumed by an existing NestJS backend.

---

## Architecture Overview

```
NestJS Backend (EC2)
      ↓ HTTP + x-api-key
WhatsApp Microservice (EC2)
      ↓
Redis (session store + message queue + status)
      ↓
WhatsApp Servers (via whatsapp-web.js WebSocket)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| WhatsApp | whatsapp-web.js |
| Session Store | Redis |
| Message Queue | Redis (bullmq) |
| Process Manager | PM2 |
| Infrastructure | AWS EC2 (single instance) |

---

## Core Features

### 1. Customer WhatsApp Linking
- Generate QR code when customer initiates connection
- Send QR to frontend
- Save session to Redis on successful scan
- Store connection status per customer in Redis
- Support re-linking flow when session expires

### 2. Session Management
- One WhatsApp session per customer (identified by `customerId`)
- Sessions persisted in Redis (survive server restarts)
- Restore all active sessions automatically on server boot
- In-memory client cache for active sessions
- Detect and handle disconnections gracefully

### 3. Message Sending
- Send message on behalf of any connected customer
- Messages appear in customer's personal WhatsApp (sent items)
- Queue-based sending via Redis (reliable, no message loss)
- Dead-letter queue for failed messages
- Message history logged per customer in Redis
- Link will also be part of message example payment link
- Good to have Media/file sending also supported
- As this is more like a backend service from generating QR to sending message, I should be able to test this with simple postman also

### 4. Event Triggers (consumed via API)
The microservice exposes REST endpoints so any nestjs service can trigger messages based on events such as:
- Appointment status
- Invoice status
- Payment status

### 5. Security
- API key authentication on all endpoints (`x-api-key` header)
- Works from any caller — local dev, NestJS EC2, Postman
- No IP restriction required (API key is the auth layer)

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/connect/:customerId` | Initialise WhatsApp session, emit QR via socket |
| GET | `/status/:customerId` | Get connection status for a customer |
| POST | `/send` | Queue a message for a customer |
| GET | `/history/:customerId` | Fetch sent message history |
| POST | `/disconnect/:customerId` | Manually unlink a customer session |

### Request — `/send`
```json
{
  "customerId": "cust_123",
  "phone": "911234567890",
  "message": "Your appointment has been confirmed!"
}
```

---

## Redis Key Structure

| Key | Value | TTL |
|---|---|---|
| `whatsapp:session:{customerId}` | Session credentials (JSON) | 30 days |
| `whatsapp:status:{customerId}` | connected / disconnected / awaiting_scan | None |
| `whatsapp:queue` | List of pending messages | None |
| `whatsapp:queue:failed` | List of failed messages | None |
| `whatsapp:history:{customerId}` | List of sent messages | None |

---

## Session Lifecycle

```
Customer hits /connect
      ↓
QR generaated
      ↓
Customer scans with WhatsApp app
      ↓
Session saved to Redis
      ↓
Status set to "connected"
      ↓
Messages can now be sent on their behalf
      ↓
If phone goes offline / customer unlinks
      ↓
Status set to "disconnected"
      ↓
Notification sent to customer to re-link
```

---

## Environment Variables

```bash
PORT=3001
API_KEY=your-secret-api-key
REDIS_URL=redis://localhost:6379
```

---

## Deployment

- Runs on a single EC2 instance (t3.small recommended)
- Redis runs on the same EC2 instance 
- PM2 manages the process and auto-restarts on crash or reboot
- No public IP required if called only from NestJS EC2 (use private IP)
- Open port 3001 publicly only if local dev access is needed

---

## Calling from NestJS

```
Local Dev  → http://<EC2-public-ip>:3001  + x-api-key header
Production → http://<EC2-private-ip>:3001 + x-api-key header
```

Use `@nestjs/axios` HttpService with `baseURL` and `x-api-key` header set globally via `HttpModule.registerAsync`.

---

## Out of Scope

- WhatsApp Business API (Meta) — this is personal number only
- Multi-device support per customer
- Built-in frontend UI (QR display handled by consuming app)
- Billing or usage tracking

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| WhatsApp bans number for spam | Warn customers, rate limit sends |
| Phone goes offline | Detect via `disconnected` event, notify customer to re-link |
| Server restart drops sessions | Auto-restore from Redis on boot |
| Session expires in Redis | 30-day TTL, refresh on activity |