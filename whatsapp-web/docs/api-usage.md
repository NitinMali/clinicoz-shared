# API Usage Guide — WhatsApp Microservice

Base URL: `http://<EC2_HOST>:3001`

All endpoints require the `x-api-key` header unless marked as public.

---

## Authentication

```
x-api-key: your-api-key-here
```

---

## Connection Endpoints

### Initiate Connection

Starts the QR code generation flow for a customer.

```
POST /whatsapp/connect/:customerId
```

**Body (optional):**

```json
{
  "allowedPhone": "919999999999"
}
```

If `allowedPhone` is provided, only that phone number will be accepted when scanning the QR. Any other number will be immediately disconnected.

**Response (202):**

```json
{
  "customerId": "cust_123",
  "status": "awaiting_scan",
  "qrUrl": "/whatsapp/connect/cust_123/qr",
  "qrImageUrl": "/whatsapp/connect/cust_123/qr/image",
  "statusUrl": "/whatsapp/status/cust_123",
  "allowedPhone": "919999999999",
  "note": "Only this phone number will be accepted."
}
```

| Field | Description |
|---|---|
| `qrUrl` | Poll this (with `x-api-key`) to get QR data as JSON + base64 image |
| `qrImageUrl` | Public PNG endpoint — use directly in `<img src="...">` without auth |
| `statusUrl` | Poll this to check when status changes to `connected` |

---

### Get QR Code (JSON) — requires `x-api-key`

Returns QR data and base64 image. Used by your backend MS to get QR data programmatically and forward to the frontend.

```
GET /whatsapp/connect/:customerId/qr
```

**Response (QR ready):**

```json
{
  "customerId": "cust_123",
  "status": "awaiting_scan",
  "qrCode": "2@ABC123...",
  "qrImage": "data:image/png;base64,iVBOR..."
}
```

**Response (QR still generating):**

```json
{
  "customerId": "cust_123",
  "status": "awaiting_scan",
  "qrCode": null,
  "qrImage": null,
  "message": "QR code is still being generated. Try again in a few seconds."
}
```

**Response (already connected):**

```json
{
  "customerId": "cust_123",
  "status": "connected",
  "qrCode": null,
  "qrImage": null
}
```

---

### Get QR Code (Image) — Public, no auth required

Returns the QR code as a raw PNG image. Can be used directly in `<img>` tags without needing to pass `x-api-key`.

```
GET /whatsapp/connect/:customerId/qr/image
```

No `x-api-key` required.

**Response:** PNG image with headers:
- `Content-Type: image/png`
- `X-QR-Status: ready | in-progress | connected | disconnected`
- `Cache-Control: no-store`

**Usage in HTML:**

```html
<img src="http://host:3001/whatsapp/connect/cust_123/qr/image" />
```

The image auto-refreshes content based on state:
- QR ready → shows the QR code
- In progress → shows a "generating" placeholder
- Connected/Disconnected → shows a status placeholder

---

<!-- ### Get Connection Status -->

```
GET /whatsapp/status/:customerId
```

**Response:**

```json
{
  "customerId": "cust_123",
  "status": "connected"
}
```

Possible statuses: `connected`, `disconnected`, `awaiting_scan`

---

### Disconnect

Logs out the WhatsApp session and removes all data for the customer.

```
POST /whatsapp/disconnect/:customerId
```

**Response:**

```json
{
  "customerId": "cust_123",
  "status": "disconnected"
}
```

---

### Admin Stats

Returns service health and session statistics.

```
GET /whatsapp/admin/stats
```

**Response:**

```json
{
  "uptime": 3600,
  "memory": {
    "rss": "245.3MB",
    "heapUsed": "89.1MB",
    "heapTotal": "120.5MB"
  },
  "sessions": {
    "totalConnected": 5,
    "browsersAwake": 2,
    "browsersSleeping": 3,
    "customers": [
      {
        "customerId": "cust_123",
        "browserState": "awake",
        "lastActivity": "2026-05-17T10:30:00.000Z"
      },
      {
        "customerId": "cust_456",
        "browserState": "sleeping",
        "lastActivity": "2026-05-17T09:15:00.000Z"
      }
    ]
  },
  "idleTimeoutMs": 600000
}
```

---

## Messaging Endpoints

### Send Message

Queues a message for delivery via WhatsApp.

```
POST /messaging/send
```

**Body:**

```json
{
  "customerId": "cust_123",
  "phone": "919876543210",
  "message": "Your appointment is confirmed for tomorrow at 10 AM.",
  "mediaUrl": "https://example.com/invoice.pdf"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `customerId` | string | Yes | The customer whose WhatsApp session to use |
| `phone` | string | Yes | Recipient phone number (with country code, no +) |
| `message` | string | Yes | Text message content |
| `mediaUrl` | string | No | URL of media to attach (image, PDF, video) |

**Response (202):**

```json
{
  "jobId": "job_abc123",
  "message": "Message queued"
}
```

The message is processed asynchronously. If the customer's browser is sleeping, it will be woken up automatically (~5-10s delay).

---

### Get Message History

```
GET /messaging/history/:customerId?limit=20&offset=0
```

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 50 | Number of messages to return |
| `offset` | number | 0 | Offset for pagination |

**Response:**

```json
{
  "customerId": "cust_123",
  "messages": [
    {
      "customerId": "cust_123",
      "phone": "919876543210",
      "message": "Your appointment is confirmed.",
      "mediaUrl": null,
      "timestamp": "2026-05-17T10:30:00.000Z",
      "status": "delivered",
      "jobId": "job_abc123"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

---

## Typical Integration Flow

```
Backend MS                          WhatsApp MS
    │                                    │
    ├── POST /whatsapp/connect/cust_123 ─►│  (with allowedPhone)
    │                                    │
    │◄── 202 { status: awaiting_scan } ──┤
    │                                    │
    ├── GET /whatsapp/connect/cust_123/qr ►│  (poll every 3-5s)
    │                                    │
    │◄── { qrCode, qrImage } ───────────┤  (show to user)
    │                                    │
    │         ... user scans QR ...       │
    │                                    │
    ├── GET /whatsapp/status/cust_123 ───►│
    │                                    │
    │◄── { status: "connected" } ────────┤
    │                                    │
    │         ... later ...               │
    │                                    │
    ├── POST /messaging/send ────────────►│
    │   { customerId, phone, message }    │
    │                                    │
    │◄── 202 { jobId } ─────────────────┤
    │                                    │
```

---

## Frontend Integration — QR Polling Pattern

The `/qr/image` endpoint is public and returns different images based on state. It also returns an `X-QR-Status` header so you can detect state changes in a single request.

### Polling with `X-QR-Status` header

```javascript
const customerId = 'cust_123';
const baseUrl = 'http://host';

const poll = setInterval(async () => {
  const res = await fetch(`${baseUrl}/whatsapp/connect/${customerId}/qr/image?t=${Date.now()}`);
  const status = res.headers.get('X-QR-Status');

  // Update image
  const blob = await res.blob();
  document.getElementById('qr').src = URL.createObjectURL(blob);

  if (status === 'connected') {
    clearInterval(poll);
    // Show connected UI, hide QR section, etc.
  }
}, 5000);
```

### Image states returned by `/qr/image`

| State | Image shown | `X-QR-Status` header |
|---|---|---|
| Chromium still launching | `qr-in-progress.png` | `in-progress` |
| QR ready to scan | Actual QR code | `ready` |
| User scanned, session active | `qr-connected.png` | `connected` |
| No session / disconnected | `qr-dis-connected.png` | `disconnected` |

### Recommended polling intervals

| What | Interval | Why |
|---|---|---|
| QR image refresh | 5s | WhatsApp rotates QR every ~20s, 5s keeps it fresh |
| Stop polling after | 2 min | If no scan in 2 min, QR expires anyway |

---

## Error Responses

All errors follow a consistent format:

```json
{
  "statusCode": 404,
  "message": "No active session for customer cust_123",
  "error": "Not Found"
}
```

| Status | When |
|---|---|
| 400 | Invalid request body (missing fields, wrong types) |
| 401 | Missing or invalid `x-api-key` |
| 404 | Customer not found / no session |
| 409 | Customer already connected (on POST /connect) |

---

## Debugging

### Redis Inspection

```bash
# Check a customer's status
redis-cli GET whatsapp:status:cust_123

# Check if QR exists
redis-cli GET whatsapp:qr:cust_123

# Check allowed phone
redis-cli GET whatsapp:allowed_phone:cust_123

# Check message history length
redis-cli LLEN whatsapp:history:cust_123

# List all connected customers
redis-cli KEYS whatsapp:status:*
```

### Health Check

```bash
curl http://localhost:3001/whatsapp/admin/stats \
  -H "x-api-key: YOUR_KEY"
```
