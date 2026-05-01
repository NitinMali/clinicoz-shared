# WhatsApp Microservice

A standalone NestJS microservice that enables customers to link their personal WhatsApp number via QR code scanning and send messages on their behalf. Built with `whatsapp-web.js`, Redis, and BullMQ.

## Prerequisites

- **Node.js** >= 18
- **Redis** running locally or remotely
- **npm** or **yarn**
- **PM2** (optional, for production deployment)

## Setup

### 1. Install dependencies

```bash
cd whatsapp-web
npm install
```

### 2. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3001
REDIS_URL=redis://localhost:6379
API_KEY=your-secret-api-key-min-16-chars
```

| Variable    | Required | Default | Description                          |
|-------------|----------|---------|--------------------------------------|
| `PORT`      | No       | 3001    | HTTP port the service listens on     |
| `REDIS_URL` | Yes      | —       | Redis connection URI                 |
| `API_KEY`   | Yes      | —       | API key for authentication (min 16 chars) |

The app will fail to start if `REDIS_URL` or `API_KEY` is missing.

## Build

```bash
npm run build
```

This compiles TypeScript to `dist/`.

## Run

### Development

```bash
npm run start:dev
```

### Production

```bash
npm run build
npm run start:prod
```

### With PM2 (recommended for EC2)

```bash
npm run build
pm2 start ecosystem.config.js
```

To persist across reboots:

```bash
pm2 startup    # follow the printed instructions
pm2 save
```

## Tests

```bash
npm test                # run all tests
npm run test:cov        # run with coverage
```

## API Reference

All endpoints require the `x-api-key` header unless marked as **public**.

### Connect a customer (async)

```
POST /whatsapp/connect/:customerId
```

Initiates a WhatsApp connection in the background. Returns immediately with `202`. The QR code is generated asynchronously — poll the QR endpoints below to retrieve it.

**Response 202:**
```json
{
  "customerId": "cust_123",
  "status": "awaiting_scan",
  "message": "Connection initiated. Poll GET /whatsapp/connect/:customerId/qr for the QR code."
}
```

**Response 409:** Customer is already connected.

---

### Get QR code (JSON)

```
GET /whatsapp/connect/:customerId/qr
```

Returns the QR code data as JSON. Poll this after calling connect.

**QR still generating:**
```json
{
  "customerId": "cust_123",
  "status": "awaiting_scan",
  "qrCode": null,
  "qrImage": null,
  "message": "QR code is still being generated. Try again in a few seconds."
}
```

**QR ready:**
```json
{
  "customerId": "cust_123",
  "status": "awaiting_scan",
  "qrCode": "raw-qr-string...",
  "qrImage": "data:image/png;base64,iVBORw0KGgo..."
}
```

**Already connected:**
```json
{
  "customerId": "cust_123",
  "status": "connected",
  "qrCode": null,
  "qrImage": null
}
```

---

### Get QR code (PNG image) — PUBLIC, no API key required

```
GET /whatsapp/connect/:customerId/qr/image
```

Returns a raw PNG image. No authentication required — safe to use directly in frontend `<img>` tags.

```html
<img src="http://localhost:3001/whatsapp/connect/cust_123/qr/image" />
```

The endpoint always returns `200` with `Content-Type: image/png` and serves different images based on state:

| State | Image served | `X-QR-Status` header |
|---|---|---|
| QR ready (awaiting scan) | Real WhatsApp QR code | `ready` |
| QR still generating | `qr-in-progress.png` placeholder | `in-progress` |
| Disconnected / no session | `qr-dis-connected.png` placeholder | `disconnected` |

- `Cache-Control: no-store` — safe to poll/refresh, browser won't cache
- Check `X-QR-Status` header to know when to stop polling

---

### Check connection status

```
GET /whatsapp/status/:customerId
```

**Response 200:**
```json
{
  "customerId": "cust_123",
  "status": "connected"
}
```

Possible statuses: `connected`, `disconnected`, `awaiting_scan`

**Response 404:** No session found for customer.

---

### Send a message

```
POST /messaging/send
Content-Type: application/json
```

**Request body:**
```json
{
  "customerId": "cust_123",
  "phone": "911234567890",
  "message": "Hello from the microservice!",
  "mediaUrl": "https://example.com/image.png"
}
```

`mediaUrl` is optional. Supports image, document, and video files.

**Response 202:**
```json
{
  "jobId": "job_abc123",
  "message": "Message queued"
}
```

**Response 409:** Customer is not connected.
**Response 400:** Validation error (missing/invalid fields).

---

### Get message history

```
GET /messaging/history/:customerId?limit=50&offset=0
```

**Response 200:**
```json
{
  "customerId": "cust_123",
  "messages": [
    {
      "customerId": "cust_123",
      "phone": "911234567890",
      "message": "Hello!",
      "mediaUrl": null,
      "timestamp": "2026-04-24T10:30:00.000Z",
      "status": "delivered",
      "jobId": "job_abc123"
    }
  ],
  "total": 1
}
```

---

### Disconnect a customer

```
POST /whatsapp/disconnect/:customerId
```

Terminates the session and removes all Redis keys (session, QR, status). After disconnect, the QR image endpoint returns the disconnected placeholder.

**Response 200:**
```json
{
  "customerId": "cust_123",
  "status": "disconnected"
}
```

**Response 404:** No active session for customer.

## Typical Flow

```
1. POST /whatsapp/connect/cust_123          → 202 (connection started)
2. GET  /whatsapp/connect/cust_123/qr/image → PNG (poll every 2-3s)
   ↳ Shows placeholder until QR is ready, check X-QR-Status header
3. Customer scans QR with WhatsApp mobile app
4. GET  /whatsapp/status/cust_123           → { status: "connected" }
5. POST /messaging/send                     → 202 (message queued)
6. GET  /messaging/history/cust_123         → message list
7. POST /whatsapp/disconnect/cust_123       → disconnected, all keys removed
```

## Error Responses

All errors follow a consistent format:

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "timestamp": "2026-04-24T10:30:00.000Z",
  "path": "/whatsapp/connect/cust_123"
}
```

## Quick Start with cURL

```bash
API_KEY="your-secret-api-key-min-16-chars"
BASE_URL="http://localhost:3001"

# 1. Start connection (returns immediately)
curl -X POST "$BASE_URL/whatsapp/connect/cust_123" \
  -H "x-api-key: $API_KEY"

# 2. Poll for QR (JSON — requires API key)
curl "$BASE_URL/whatsapp/connect/cust_123/qr" \
  -H "x-api-key: $API_KEY"

# 2b. Or get QR as PNG image (PUBLIC — no API key needed)
curl "$BASE_URL/whatsapp/connect/cust_123/qr/image" -o qr.png
# Or just open in browser: http://localhost:3001/whatsapp/connect/cust_123/qr/image

# 3. Check status (after scanning)
curl "$BASE_URL/whatsapp/status/cust_123" \
  -H "x-api-key: $API_KEY"

# 4. Send a message
curl -X POST "$BASE_URL/messaging/send" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"cust_123","phone":"911234567890","message":"Hello!"}'

# 5. Get message history
curl "$BASE_URL/messaging/history/cust_123?limit=10" \
  -H "x-api-key: $API_KEY"

# 6. Disconnect (removes all Redis keys)
curl -X POST "$BASE_URL/whatsapp/disconnect/cust_123" \
  -H "x-api-key: $API_KEY"
```

## Architecture

- **whatsapp-web.js** — WhatsApp Web client with local session persistence
- **BullMQ** — Message queue with retry (3 attempts, exponential backoff) and dead-letter queue
- **Redis** — Single external dependency for status, QR codes, queues, and history
- **PM2** — Process management with auto-restart and reboot persistence

## Project Structure

```
src/
├── main.ts                          # Bootstrap
├── app.module.ts                    # Root module
├── qr-in-progress.png              # Placeholder image (QR generating)
├── qr-dis-connected.png            # Placeholder image (disconnected)
├── config/
│   ├── config.module.ts             # Global config with env validation
│   └── env.validation.ts            # Joi schema
├── auth/
│   ├── auth.module.ts
│   ├── api-key.guard.ts             # Global x-api-key guard
│   └── public.decorator.ts          # @Public() decorator to skip auth
├── whatsapp/
│   ├── whatsapp.module.ts
│   ├── whatsapp.controller.ts       # /whatsapp/* endpoints
│   ├── whatsapp-session.service.ts  # Session lifecycle + async QR
│   ├── redis-auth-store.ts          # Redis-backed auth store
│   └── whatsapp.interfaces.ts       # Types and enums
├── messaging/
│   ├── messaging.module.ts
│   ├── messaging.controller.ts      # /messaging/* endpoints
│   ├── message-queue.service.ts     # BullMQ producer
│   ├── message.processor.ts         # BullMQ worker
│   └── message-history.service.ts   # Redis list history
└── shared/
    ├── constants.ts                 # Redis keys, queue names
    ├── http-exception.filter.ts     # Global error filter
    └── dto/
        ├── send-message.dto.ts
        └── connect-response.dto.ts
```
