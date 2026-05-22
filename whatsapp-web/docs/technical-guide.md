# Technical Guide — WhatsApp Microservice

This document covers the internals: how whatsapp-web.js works, session lifecycle, message queue architecture, Redis data model, security, deployment, and known limitations.

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
| `ready` | Session authenticated after QR scan | Validate phone number, set status to `connected`, delete QR from Redis |
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

### Authentication Strategy: LocalAuth

We use `LocalAuth` which stores session data on the local filesystem under `.wwebjs_auth/session-{clientId}/`. This directory contains the Chromium user profile with WhatsApp's authentication tokens.

Advantages:
- Works out of the box, no external dependencies beyond the filesystem
- Sessions survive app restarts (Chromium profile persists on disk)

Tradeoffs:
- Tied to the local machine — sessions don't transfer between servers
- Disk usage grows with number of customers (~50-100MB per session)
- For multi-server deployment, consider migrating to `RemoteAuth` with S3/Redis storage

### Phone Number Validation

When initiating a connection, you can pass an `allowedPhone` number. After the QR is scanned and the session becomes ready, the service checks `client.info.wid.user` (the authenticated phone number) against the stored allowed number. If it doesn't match, the session is immediately logged out and destroyed.

This prevents unauthorized numbers from linking to a customer's account.

### Session State Machine

```
[No Session] → POST /connect → [awaiting_scan]
[awaiting_scan] → QR scanned → phone validated → [connected] → idle timer starts
[awaiting_scan] → QR scanned → phone mismatch → [disconnected]
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
4. The session stays valid: status remains `connected` in Redis, session files stay on disk
5. When the next message needs to be sent, `ensureClientReady()` re-launches Chromium from the saved session — no QR scan needed, takes ~5-10 seconds
6. The idle timer restarts after the wake-up

This means RAM usage scales with *concurrently active* customers, not total connected customers.

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
| `whatsapp:allowed_phone:{customerId}` | String | None | Allowed phone number for this customer (validated on QR scan) |
| `whatsapp:session:{customerId}` | String/Binary | 30 days | Session credentials (reserved for future RemoteAuth) |
| `whatsapp:history:{customerId}` | List (JSON strings) | None | Message history, newest first (LPUSH) |
| `bull:whatsapp-messages:*` | BullMQ internal | Per config | Message queue jobs |
| `bull:whatsapp-messages-dlq:*` | BullMQ internal | None | Dead-letter queue for failed messages |

### Disconnect Cleanup

When `POST /disconnect/:customerId` is called, ALL Redis keys for that customer are deleted:
- `whatsapp:status:{customerId}`
- `whatsapp:qr:{customerId}`
- `whatsapp:allowed_phone:{customerId}`
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
  → ensureClientReady() — wakes sleeping browser if needed
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
  backoff: { type: 'exponential', delay: 15000 },
  removeOnComplete: true,
  removeOnFail: false,
}
```

Retry schedule: 15s → 30s → 60s (exponential). Total worst case before DLQ: ~1 min 45s.

### Dead-Letter Queue (DLQ)

Messages that exhaust all 3 retries are moved to the DLQ. A background service auto-retries DLQ jobs every 2 minutes, giving them another round of 3 attempts. This handles transient issues (browser wake-up, detached frames) without manual intervention.

### Delivery Callback

When sending a message, the caller can provide `referenceId` and `callbackUrl`. The service will POST to the callback URL on both successful delivery and permanent failure:

- On success: `{ referenceId, status: "delivered", jobId, phone, timestamp }`
- On failure: `{ referenceId, status: "failed", jobId, phone, failureReason, attempts, timestamp }`

### Message Footer

All messages are appended with a footer: `_Sent via Clinicoz_` (rendered as italic in WhatsApp), separated by two blank lines from the original message.

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

---

## Resource Usage and Scaling

### Memory (with idle timeout enabled)

| Total connected | Concurrently active | Estimated RAM |
|---|---|---|
| 50 | 5 | 0.75-1.5GB |
| 100 | 10 | 1.5-3GB |
| 500 | 20 | 3-6GB |

### Recommended EC2 Sizing

| Total customers | Concurrently active | Instance Type | RAM |
|---|---|---|---|
| 1-20 | 1-5 | t3.medium | 4GB |
| 20-100 | 5-15 | t3.large | 8GB |
| 100-500 | 15-30 | t3.xlarge | 16GB |

---

## Deployment

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | 3001 | Server port |
| `REDIS_URL` | Yes | — | Redis connection URI |
| `API_KEY` | Yes | — | Min 16 characters, used for x-api-key auth |
| `SESSION_IDLE_TIMEOUT_MS` | No | 600000 | Idle timeout in ms. Set to 0 to disable. |

### PM2 Process Management

The `ecosystem.config.js` configures:
- `autorestart: true` — Restarts on crash
- `max_restarts: 10` — Prevents restart loops
- Use `pm2 startup` + `pm2 save` for EC2 reboot persistence

### Filesystem Persistence

The `.wwebjs_auth/` directory must persist across deployments:
- On EC2: stored on the instance's EBS volume (survives reboots)
- On Docker: mount as a volume (`-v /data/wwebjs_auth:/app/.wwebjs_auth`)

---

## Known Limitations

### WhatsApp Terms of Service

whatsapp-web.js is an unofficial library. Risks include:
- Account bans (temporary or permanent)
- Rate limiting by WhatsApp
- Breaking changes when WhatsApp updates their web client

Mitigations:
- Don't send bulk/spam messages
- Respect rate limits (~10-15 messages per minute per number)
- Monitor for ban signals (auth_failure events, unexpected disconnects)

### Single-Server Limitation

Sessions are tied to the local filesystem. No horizontal scaling — each customer's session lives on one server.

### QR Code Timing

- QR codes expire every ~20 seconds
- Redis TTL is 2 minutes (stores the latest QR)
- WhatsApp stops generating QRs after ~5 rotations (~100 seconds)

### Media Sending

- `MessageMedia.fromUrl()` downloads the file to memory before sending
- Large files (>16MB) may fail or cause memory spikes
- Supported types: images, documents, videos (same as WhatsApp Web)

---

## Debugging

### PM2 Logs

```bash
# Live logs
sudo pm2 logs whatsapp-microservice

# Last 50 lines
sudo pm2 logs whatsapp-microservice --lines 50
```

### Redis Inspection

```bash
# Check a customer's connection status
redis-cli GET whatsapp:status:<customerId>

# Check if QR exists (should have value when awaiting scan)
redis-cli GET whatsapp:qr:<customerId>

# Check allowed phone number for a customer
redis-cli GET whatsapp:allowed_phone:<customerId>

# Check message history
redis-cli LRANGE whatsapp:history:<customerId> 0 10

# List all connected customers
redis-cli KEYS whatsapp:status:*

# Inspect dead-letter queue (failed messages)
redis-cli KEYS bull:whatsapp-messages-dlq:*

# View a specific DLQ entry (shows failure reason, attempts, original message)
redis-cli HGETALL bull:whatsapp-messages-dlq:<jobId>
```

### Common Issues

**"The browser is already running" error in DLQ:**

A stale `SingletonLock` file is blocking Chromium from launching. The app handles this automatically on startup (cleans stale locks), but if it happens:

```bash
# Remove all stale lock files
sudo find /home/ubuntu/whatsapp-web/.wwebjs_auth -name "SingletonLock" -delete

# Kill any orphaned Chromium
sudo pkill -f chromium || true

# Restart
sudo pm2 restart whatsapp-microservice
```

Then reconnect the customer (POST `/connect`).

**Session shows "connected" in Redis but messages fail:**

The browser was sleeping (idle timeout) and wake-up failed. Check:

```bash
# Is the browser actually running?
ps aux | grep chromium

# Check if lock file exists
ls -la /home/ubuntu/whatsapp-web/.wwebjs_auth/session-<customerId>/SingletonLock
```

If the lock file exists but no Chromium process is running (stale lock), remove it:

```bash
sudo rm -f /home/ubuntu/whatsapp-web/.wwebjs_auth/session-<customerId>/SingletonLock
```

**QR image stuck on "in-progress":**

Chromium is still launching. Wait 10-15 seconds and refresh. If it persists:

```bash
# Check if Chromium started
ps aux | grep chromium

# Check logs for launch errors
sudo pm2 logs whatsapp-microservice --lines 20
```

**After deploy, first message fails:**

Expected — the old Chromium process was killed during deploy. The customer needs to reconnect (POST `/connect` + scan QR) or the next retry will succeed once the browser wakes up.

### Cleanup Commands

```bash
# Clear all DLQ entries
redis-cli KEYS "bull:whatsapp-messages-dlq:*" | xargs redis-cli DEL

# Clear message history for a customer
redis-cli DEL whatsapp:history:<customerId>

# Remove all stale lock files
sudo find /home/ubuntu/whatsapp-web/.wwebjs_auth -name "SingletonLock" -delete

# Full reset before fresh deploy
sudo pm2 stop whatsapp-microservice || true
sudo pm2 delete whatsapp-microservice || true
sudo pkill -f chromium || true
sudo find /home/ubuntu/whatsapp-web/.wwebjs_auth -name "SingletonLock" -delete
redis-cli KEYS "bull:whatsapp-messages-dlq:*" | xargs redis-cli DEL
```

### Health Check

```bash
# Quick service check (public, no auth needed)
curl http://localhost:80/health

# Detailed stats (requires x-api-key)
curl http://localhost:80/whatsapp/admin/stats -H "x-api-key: YOUR_KEY"
```
