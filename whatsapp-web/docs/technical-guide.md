# Technical Guide — WhatsApp Microservice

This document covers the internals of the WhatsApp microservice: how whatsapp-web.js works under the hood, session lifecycle, message queue architecture, Redis data model, security, deployment considerations, and known limitations.

---

## How whatsapp-web.js Works

whatsapp-web.js is a Node.js library that automates WhatsApp Web using Puppeteer (headless Chromium). It does not use the official WhatsApp Business API — it mimics a browser session on web.whatsapp.com.

### Under the Hood

1. `client.initialize()` launches a headless Chromium browser via Puppeteer
2. The browser navigates to `web.whatsapp.com`
3. WhatsApp's servers send a QR code through the page
4. The library intercepts the QR data and emits a `qr` event
5. Once the user scans the QR with their phone, WhatsApp authenticates the browser session
6. The library emits a `ready` event — the client is now connected
7. Messages are sent by executing JavaScript inside the WhatsApp Web page context

### Key Events

| Event | When it fires | What we do |
|---|---|---|
| `qr` | WhatsApp sends a QR code | Store in Redis, serve via API |
| `ready` | Session authenticated after QR scan | Set status to `connected`, delete QR from Redis |
| `authenticated` | Credentials validated (before `ready`) | Internal — handled by auth strategy |
| `auth_failure` | Stored credentials are invalid | Clean up, set status to `disconnected` |
| `disconnected` | Phone goes offline, user unlinks, or session expires | Clean up, set status to `disconnected` |

### QR Code Lifecycle

- WhatsApp rotates QR codes every ~20 seconds
- Each QR is single-use — once scanned, it's consumed
- If not scanned, WhatsApp sends a new QR (fires another `qr` event)
- Our service stores the latest QR in Redis with a 2-minute TTL
- After ~5 rotations without a scan, WhatsApp stops generating QRs

### Puppeteer Configuration

Each `Client` instance launches its own Chromium process with these flags:

```
--no-sandbox              # Required for running as root / in containers
--disable-setuid-sandbox  # Same as above
--disable-dev-shm-usage   # Prevents /dev/shm exhaustion in Docker
--disable-gpu             # No GPU needed for headless
--disable-extensions      # Faster startup
```

Each connected customer = one Chromium process. Plan memory accordingly (~150-300MB per session).

---

## Session Management

We need to have set of questioner for customer about how many invoices they generate, payment links and expect appointment booking from website?

NO bulk message will be possible with this method. They need to create own boardcasting channel in whatsapp or use status.

Compare the market costing & expense report.

### Authentication Strategy: LocalAuth

We use `LocalAuth` which stores session data on the local filesystem under `.wwebjs_auth/session-{clientId}/`. This directory contains the Chromium user profile with WhatsApp's authentication tokens.

Advantages:
- Works out of the box, no external dependencies beyond the filesystem
- Sessions survive app restarts (Chromium profile persists on disk)

Tradeoffs:
- Tied to the local machine — sessions don't transfer between servers
- Disk usage grows with number of customers (~50-100MB per session)
- For multi-server deployment, consider migrating to `RemoteAuth` with S3/Redis storage

### Session State Machine

```
[No Session] → POST /connect → [awaiting_scan]
[awaiting_scan] → QR scanned → [connected] → idle timer starts
[awaiting_scan] → Timeout (90s) → [disconnected]
[connected] → Message sent → idle timer resets
[connected] → Idle timeout (10 min) → [connected, browser sleeping]
[connected, browser sleeping] → Message arrives → browser wakes up (~5-10s) → message sent
[connected] → Phone offline → [disconnected]
[connected] → POST /disconnect → [No Session] (all keys deleted)
[disconnected] → POST /connect → [awaiting_scan]
```

### Idle Timeout (Memory Optimization)

To avoid keeping Chromium processes running 24/7 for every connected customer, the service implements a per-customer idle timeout:

1. After a customer connects (QR scanned) or sends a message, a `setTimeout` timer starts (default: 10 minutes)
2. Each message sent resets the timer
3. When the timer fires, the Chromium process is destroyed — freeing ~150-300MB RAM
4. The session stays valid: status remains `connected` in Redis, session files stay on disk (`.wwebjs_auth/`)
5. When the next message needs to be sent, `ensureClientReady()` re-launches Chromium from the saved session — no QR scan needed, takes ~5-10 seconds
6. The idle timer restarts after the wake-up

This means RAM usage scales with *concurrently active* customers, not total connected customers.

**Performance note**: `setTimeout` in Node.js is essentially free. It doesn't "tick" — it just registers a callback in the event loop's timer queue. Even 10,000 pending timers have negligible CPU/memory overhead. It's just a sorted list of timestamps internally.

**Configuration**: Set `SESSION_IDLE_TIMEOUT_MS` in `.env` (default: 600000 = 10 minutes). Set to `0` to disable.

### Lazy Session Restore on Startup

On startup, the service does NOT eagerly restore all sessions. Instead:

1. It scans Redis for `whatsapp:status:*` keys with value `connected`
2. Logs how many sessions were found
3. Does nothing else — no Chromium processes launched

Sessions are woken up on demand when a message needs to be sent. This means:
- Fast startup regardless of how many customers are connected
- Minimal RAM usage at boot
- First message after restart has a ~5-10 second delay (browser wake-up)

---

## Redis Data Model

All state is stored in Redis. The microservice is stateless except for the in-memory `Map<string, Client>` holding active Chromium instances.

### Key Schema

| Key | Type | TTL | Description |
|---|---|---|---|
| `whatsapp:status:{customerId}` | String | None | Connection status: `connected`, `disconnected`, `awaiting_scan` |
| `whatsapp:qr:{customerId}` | String | 120s | Raw QR code data (auto-expires) |
| `whatsapp:session:{customerId}` | String/Binary | 30 days | Session credentials (used by RedisAuthStore, reserved for future RemoteAuth) |
| `whatsapp:history:{customerId}` | List (JSON strings) | None | Message history, newest first (LPUSH) |
| `bull:whatsapp-messages:*` | BullMQ internal | Per config | Message queue jobs |
| `bull:whatsapp-messages-dlq:*` | BullMQ internal | None | Dead-letter queue for failed messages |

### Disconnect Cleanup

When `POST /disconnect/:customerId` is called, ALL Redis keys for that customer are deleted:
- `whatsapp:status:{customerId}`
- `whatsapp:qr:{customerId}`
- `whatsapp:session:{customerId}`

The customer effectively ceases to exist in the system. Message history is preserved.

---

## Message Queue Architecture

### BullMQ Setup

The microservice uses two BullMQ queues backed by Redis:

1. `whatsapp-messages` — Primary message queue
2. `whatsapp-messages-dlq` — Dead-letter queue for permanently failed messages

### Message Flow

```
POST /messaging/send
  → Validate DTO (class-validator)
  → Check customer status in Redis (must be "connected")
  → Add job to whatsapp-messages queue
  → Return 202 with job ID

BullMQ Worker picks up job:
  → Get Client instance from in-memory map
  → Format phone: "{phone}@c.us"
  → If mediaUrl: download media via MessageMedia.fromUrl()
  → client.sendMessage(chatId, content)
  → Log to history with status "delivered"

On failure:
  → BullMQ retries (3 attempts, exponential backoff: 5s, 10s, 20s)
  → After all retries exhausted:
    → Move to DLQ with failure reason + timestamp
    → Log to history with status "failed"
```

### Job Configuration

```typescript
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,   // Clean up successful jobs
  removeOnFail: false,       // Keep failed jobs for DLQ inspection
}
```

### Dead-Letter Queue Entry

```json
{
  "customerId": "cust_123",
  "phone": "911234567890",
  "message": "Your invoice is ready.",
  "mediaUrl": null,
  "failedAt": "2026-04-25T10:35:00.000Z",
  "failureReason": "Client disconnected during send",
  "attempts": 3,
  "originalJobId": "job_def456"
}
```

---

## Security

### API Key Authentication

- All endpoints require `x-api-key` header (except public endpoints marked with `@Public()`)
- Key is compared using `crypto.timingSafeEqual` to prevent timing attacks
- Key must be at least 16 characters (enforced by Joi validation at startup)
- The QR image endpoint (`/qr/image`) is public — it only serves PNG images

### Public Endpoints

| Endpoint | Why public |
|---|---|
| `GET /whatsapp/connect/:customerId/qr/image` | Used as `<img src="...">` in frontends — browsers can't set custom headers on image requests |

### Input Validation

- `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`
- Strips unknown properties from request bodies
- Returns 400 with descriptive errors for invalid input

### Global Exception Filter

All unhandled exceptions return a consistent JSON format:

```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "timestamp": "2026-04-25T10:30:00.000Z",
  "path": "/whatsapp/connect/cust_123"
}
```

---

## Resource Usage and Scaling

### Memory

Each WhatsApp session keeps a headless Chromium browser running — but thanks to the idle timeout, browsers are only alive for customers who are actively sending messages.

- **Per active customer** (browser awake): ~150-300MB RAM
- **Per idle customer** (browser sleeping): ~0MB RAM (just a Redis key + session files on disk)
- **During QR generation**: ~150-300MB (Chromium running)
- **During message sending**: Negligible extra on top of the browser process
- **Wake-up from sleep**: ~5-10 seconds, then ~150-300MB until idle timeout

**Without idle timeout** (all browsers running 24/7):

| Connected customers | Estimated RAM |
|---|---|
| 10 | 1.5-3GB |
| 50 | 7.5-15GB |
| 100 | 15-30GB |

**With idle timeout** (only active customers use RAM):

| Total connected | Concurrently active | Estimated RAM |
|---|---|---|
| 50 | 5 | 0.75-1.5GB |
| 100 | 10 | 1.5-3GB |
| 500 | 20 | 3-6GB |

The idle timeout makes it practical to support hundreds of connected customers on a single t3.large (8GB) instance, as long as only a fraction are actively sending at any given time.

### CPU

- Chromium is CPU-intensive during initialization (~5-10s of high CPU)
- Once connected, CPU usage drops to near-zero (WebSocket idle)
- Message sending causes brief CPU spikes

### Disk

- `.wwebjs_auth/` grows ~50-100MB per customer session
- Ensure adequate disk space on EC2
- Consider periodic cleanup of disconnected session directories

### Recommended EC2 Sizing (with idle timeout enabled)

| Total customers | Concurrently active | Instance Type | RAM |
|---|---|---|---|
| 1-20 | 1-5 | t3.medium | 4GB |
| 20-100 | 5-15 | t3.large | 8GB |
| 100-500 | 15-30 | t3.xlarge | 16GB |
| 500+ | 30+ | Multiple instances with sharding | |

These estimates assume idle timeout is enabled (default). Without it, size based on total connected customers instead.

---

## Deployment Considerations

### PM2 Process Management

The `ecosystem.config.js` configures:
- `autorestart: true` — Restarts on crash
- `max_restarts: 10` — Prevents restart loops
- Use `pm2 startup` + `pm2 save` for EC2 reboot persistence

### Redis Requirements

- Redis must be running and accessible via `REDIS_URL`
- Recommended: Redis 6+ with persistence enabled (RDB or AOF)
- For production: use Amazon ElastiCache or a managed Redis service
- BullMQ requires Redis 5.0+ (for Streams support)

### Filesystem Persistence

The `.wwebjs_auth/` directory must persist across deployments:
- On EC2: stored on the instance's EBS volume (survives reboots)
- On Docker: mount as a volume (`-v /data/wwebjs_auth:/app/.wwebjs_auth`)
- On Kubernetes: use a PersistentVolumeClaim

### Environment Variables

| Variable | Required | Default | Validation |
|---|---|---|---|
| `PORT` | No | 3001 | Must be a number |
| `REDIS_URL` | Yes | — | Must be a valid URI |
| `API_KEY` | Yes | — | Must be at least 16 characters |
| `SESSION_IDLE_TIMEOUT_MS` | No | 600000 (10 min) | Must be a number. Set to 0 to disable. |

App fails to start with a descriptive error if required validation fails.

---

## Known Limitations and Risks

### WhatsApp Terms of Service

whatsapp-web.js is an unofficial library. Using it may violate WhatsApp's Terms of Service. Risks include:
- Account bans (temporary or permanent)
- Rate limiting by WhatsApp
- Breaking changes when WhatsApp updates their web client

Mitigations:
- Don't send bulk/spam messages
- Respect rate limits (no more than ~10-15 messages per minute per number)
- Keep message content legitimate and user-initiated
- Monitor for ban signals (auth_failure events, unexpected disconnects)

### Single-Server Limitation

Sessions are tied to the local filesystem (`.wwebjs_auth/`). This means:
- No horizontal scaling — each customer's session lives on one server
- Server migration requires copying the `.wwebjs_auth/` directory
- For multi-server setups, consider implementing `RemoteAuth` with S3 storage

### Chromium Stability

- Chromium processes can crash or leak memory over time
- The `disconnected` event handler cleans up, but orphaned processes may remain
- Consider periodic health checks and process cleanup
- PM2's `autorestart` handles process-level crashes

### QR Code Timing

- QR codes expire every ~20 seconds
- Our Redis TTL is 2 minutes (stores the latest QR)
- If the frontend polls too slowly, the QR may have rotated
- WhatsApp stops generating QRs after ~5 rotations (~100 seconds)

### Media Sending

- `MessageMedia.fromUrl()` downloads the file to memory before sending
- Large files (>16MB) may fail or cause memory spikes
- Supported types: images, documents, videos (same as WhatsApp Web)
- No progress tracking for media uploads

---

## Monitoring and Debugging

### Useful Log Messages

| Log | Meaning |
|---|---|
| `Session idle timeout: Xs` | Idle timeout configured at startup |
| `Found N connected session(s)... lazy restore` | Sessions found in Redis, will wake on demand |
| `QR code generated for customer X` | Chromium is up, WhatsApp sent a QR |
| `Customer X connected successfully` | QR was scanned, session is active |
| `Idle timeout reached for customer X — sleeping browser` | Browser destroyed to save RAM, session still valid |
| `Waking up sleeping session for customer X` | Browser re-launching for a message send |
| `Session woken up for customer X` | Browser ready after wake-up |
| `Customer X disconnected: Y` | Session ended (phone offline, unlinked, etc.) |
| `Background client launch failed for X` | Chromium failed to start |
| `QR generation timed out for X` | No QR received within 90 seconds |
| `Auth failure for X` | Stored session credentials are invalid |
| `Message job X delivered successfully` | Message sent via WhatsApp |
| `Message job X exhausted all retries` | Message failed permanently, moved to DLQ |

### Redis Inspection

```bash
# Check a customer's status
redis-cli GET whatsapp:status:cust_123

# Check if QR exists
redis-cli GET whatsapp:qr:cust_123

# Check message history length
redis-cli LLEN whatsapp:history:cust_123

# List all connected customers
redis-cli KEYS whatsapp:status:*

# Inspect DLQ
redis-cli KEYS bull:whatsapp-messages-dlq:*
```

### Health Check

A quick way to verify the service is running:

```bash
curl http://localhost:3001/whatsapp/status/nonexistent \
  -H "x-api-key: YOUR_KEY"
# Should return 404 — means the service is up and auth works
```
