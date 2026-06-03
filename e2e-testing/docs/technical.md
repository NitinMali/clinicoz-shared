# Technical Documentation — Clinicoz E2E Testing Engine

## Overview

A NestJS server that executes natural-language browser tests using AI-powered element mapping (Anthropic Claude) and Playwright. Designed for Docker deployment with single-browser execution enforced via Redis/BullMQ.

**Stack:** NestJS + TypeScript + Playwright + BullMQ + Redis + Anthropic Claude

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard (public/index.html)                               │
│  - Zero-dependency HTML/CSS/JS                               │
│  - Polls GET /api/test-cases every 5s                        │
│  - Only re-renders when data changes                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────────────┐
│  NestJS API Server (server.ts → AppModule)                   │
│  ├── TestCasesController  — CRUD for test cases              │
│  ├── ExecutionController  — Trigger runs, cache, auth APIs   │
│  └── HttpExceptionFilter  — Consistent error responses       │
└──────────────────────┬──────────────────────────────────────┘
                       │ BullMQ enqueue
┌──────────────────────▼──────────────────────────────────────┐
│  Redis + BullMQ Queue ("test-execution", concurrency: 1)     │
└──────────────────────┬──────────────────────────────────────┘
                       │ Worker picks job
┌──────────────────────▼──────────────────────────────────────┐
│  ExecutionProcessor → AutomationService                      │
│  ├── injectAuth()        — Auto-login or token injection     │
│  ├── handleSpecialInstruction() — Wait/Verify/Navigate       │
│  ├── extractDirectSelector()    — CSS selectors in text      │
│  ├── getAiMapping()      — AI element mapping (fallback)     │
│  └── executeAction()     — Click/Type/Clear/Select           │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  Playwright Browser (headed in dev, headless in prod)         │
│  └── Interacts with target web application                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
e2e-testing/
├── server.ts                          # Entry point: loads .env, bootstraps NestJS
├── public/
│   └── index.html                     # Dashboard UI (single file, zero deps)
├── src/
│   ├── app.module.ts                  # Root module: wires all feature modules
│   ├── config/                        # Environment configuration
│   │   ├── config.module.ts           # Global module (available everywhere)
│   │   ├── config.service.ts          # Typed access to env vars
│   │   └── config.schema.ts           # Validation rules + defaults
│   ├── test-cases/                    # Test case CRUD
│   │   ├── test-cases.controller.ts   # REST: GET/POST/PUT/DELETE /api/test-cases
│   │   ├── test-cases.service.ts      # In-memory + file persistence (data/test-cases.json)
│   │   └── dto/                       # Validation DTOs
│   ├── execution/                     # Job queue + execution trigger
│   │   ├── execution.controller.ts    # REST: POST execute, GET job status, auth, cache
│   │   ├── execution.service.ts       # Enqueues jobs to BullMQ
│   │   ├── execution.processor.ts     # BullMQ worker (concurrency: 1)
│   │   └── execution.module.ts        # Wires queue + processor + automation
│   ├── automation/                    # Browser automation core
│   │   ├── automation.service.ts      # Main orchestrator (THE KEY FILE)
│   │   ├── automation.module.ts       # Provides AutomationService + AUTOMATION_SERVICE token
│   │   ├── browser.factory.ts         # Headed/headless Chrome config
│   │   └── action-cache.service.ts    # JSON file cache (LRU, max 5000 entries)
│   ├── ai/                            # AI element mapping
│   │   ├── ai.service.ts             # Anthropic API integration
│   │   ├── ai.module.ts              # Provides AiService
│   │   └── prompt.templates.ts        # System/user prompts for element mapping
│   └── common/                        # Shared utilities
│       ├── exceptions.ts              # Custom HTTP exceptions
│       └── http-exception.filter.ts   # Global error formatter
├── data/                              # Persisted data (gitignored)
│   ├── test-cases.json                # Saved test cases
│   └── auth.json                      # Auth configuration
├── cache/
│   └── actions.json                   # AI selector cache (LRU)
├── package.json
├── tsconfig.json
└── .env                               # Environment variables
```

---

## Request Flow: Test Execution

```
1. User clicks "Run" on dashboard
2. Dashboard → POST /api/test-cases/:id/execute
3. ExecutionController → ExecutionService.enqueue(id)
4. ExecutionService:
   - Validates test case exists
   - Checks queue depth (max 20)
   - Adds job to BullMQ queue
   - Sets test case status to "queued"
   - Returns { jobId }
5. ExecutionProcessor.process(job):
   - Sets status to "running"
   - Calls AutomationService.executeTestCase(payload)
6. AutomationService.executeTestCase():
   a. Launch browser (BrowserFactory.createConfig())
   b. injectAuth() — auto-login if data/auth.json exists
   c. Navigate to targetUrl
   d. For each instruction:
      - handleSpecialInstruction() → wait/verify/navigate (no AI)
      - extractDirectSelector() → CSS selector in text (no AI)
      - Check ActionCache → cached selector (no AI)
      - getAiMapping() → call AI for selector (last resort)
      - executeAction() → Playwright click/type/clear/select
   e. Return { status, steps, duration }
   f. FINALLY: safeClose() → browser cleanup (always runs)
7. ExecutionProcessor:
   - Sets status to "passed" or "failed"
   - Stores lastRunResult
8. Dashboard polls → sees updated status
```

---

## Key File: automation.service.ts

This is the heart of the engine. Here's the instruction processing pipeline:

```
Instruction received
       │
       ▼
┌─────────────────────────────────┐
│ 1. handleSpecialInstruction()    │  ← "Wait for...", "Verify..."
│    Returns true if handled       │     No AI call, no selector needed
└──────────────┬──────────────────┘
               │ false (needs element interaction)
               ▼
┌─────────────────────────────────┐
│ 2. extractDirectSelector()       │  ← Detects CSS selectors in text
│    e.g., [data-testid="..."]     │     #id, .class, tag[attr="val"]
│    Returns selector or null      │     No AI call
└──────────────┬──────────────────┘
               │ null (no direct selector found)
               ▼
┌─────────────────────────────────┐
│ 3. ActionCache.get()             │  ← Check if we've seen this before
│    Key = SHA256(instruction+url) │     No AI call
└──────────────┬──────────────────┘
               │ cache miss
               ▼
┌─────────────────────────────────┐
│ 4. getAiMapping()                │  ← LAST RESORT: Call AI
│    Extracts interactive elements │     Sends to Anthropic Claude
│    from page DOM                 │     Returns CSS/XPath selector
│    Caches result for next time   │
└──────────────┬──────────────────┘
               │ selector resolved
               ▼
┌─────────────────────────────────┐
│ 5. executeAction()               │  ← Performs the actual action
│    Detects action from text:     │     page.click() / page.fill()
│    "Click..." → click            │     page.fill('') for clear
│    "Type..." → fill              │     PrimeReact dropdown handling
│    "Clear..." → fill('')         │
│    "Select..." → dropdown flow   │
└─────────────────────────────────┘
```

### Action Detection Logic

The action is determined by the **first word** of the instruction (after optional step number):

| Starts with | Action | Playwright method |
|-------------|--------|-------------------|
| `Click` | Click element | `page.click(selector)` |
| `Type` / `Fill` | Type text | `page.fill(selector, text)` |
| `Clear` | Clear input | `page.fill(selector, '')` |
| `Select` | PrimeReact dropdown | `page.click(selector)` → `page.click(option)` |
| Anything else | Click (default) | `page.click(selector)` |

### Special Instructions (No AI)

Handled by `handleSpecialInstruction()` — returns `true` if processed:

| Pattern | Action |
|---------|--------|
| "Wait for" + "redirect"/"navigate" + `/path` | `page.waitForURL('**/path*')` |
| "Wait for" + "load"/"appear"/"open" | `page.waitForLoadState('networkidle')` |
| "Wait for" + "sidebar"/"panel" | `page.waitForSelector('.p-sidebar')` |
| "Wait for" + "dialog"/"modal" | `page.waitForSelector('.p-dialog')` |
| "Wait for" + "toast"/"message"/"success" | `page.waitForSelector('.p-toast-message')` |
| "Wait N seconds" | `page.waitForTimeout(N * 1000)` |
| "Verify" + URL check | Checks `page.url()` contains expected path |

---

## AI Service (ai.service.ts)

Supports two providers (auto-detected from env vars):

### Provider Selection
- Uses Anthropic API directly (api.anthropic.com)
- Requires `ANTHROPIC_API_KEY` environment variable
- Model configurable via `ANTHROPIC_MODEL` env var (default: claude-3-5-haiku-20241022)

### How Element Mapping Works

1. Extracts interactive elements from page DOM (not full HTML):
   - Only `a, button, input, textarea, select, [role="button"], li[class*="item"]`, etc.
   - Includes: id, class, type, name, placeholder, aria-label, role, text content
   - Result is ~2-5KB instead of 50KB+ full DOM

2. Sends to AI with system prompt:
   - "Return a JSON with selector, selectorType, confidence"
   - AI analyzes the element list and returns a unique CSS/XPath selector

3. Parses response, validates selector format, returns `ElementMapping`

### Retry Logic
- Max 2 retries on 5xx/connection errors
- No retry on 4xx (client errors)

### Prompt Template (prompt.templates.ts)
- System prompt: Instructs AI to return JSON `{ selector, selectorType, confidence }`
- User prompt: Instruction + DOM context + page URL

---

## Action Cache (action-cache.service.ts)

Persists successful AI mappings to avoid redundant API calls.

- **Storage:** `cache/actions.json`
- **Key:** SHA-256 hash of `instructionText + '|' + pageUrl`
- **Max entries:** 5000 (LRU eviction)
- **Cache invalidation:** When a cached selector fails to find an element (5s timeout)
- **Clear all:** `DELETE /api/cache` endpoint (or "Clear Cache" button in UI)

### Cache Flow
```
get(instruction, url) → CacheEntry | null
set(instruction, url, selector) → persists to disk
invalidate(instruction, url) → removes entry
clearAll() → wipes everything
```

---

## Auth System (Auto-Login)

Configured via dashboard UI or `data/auth.json`.

### Credentials Mode
```json
{ "loginUrl": "https://...", "email": "...", "password": "..." }
```
System navigates to loginUrl, fills email/password, clicks submit, waits 3s.

### Token Mode
```json
{ "localStorage": { "token": "jwt..." }, "cookies": [...] }
```
System navigates to domain origin, injects localStorage/cookies, then navigates to target URL.

### API Endpoints
- `GET /api/auth` — Get current config
- `PUT /api/auth` — Save config
- `DELETE /api/auth` — Clear config

---

## Browser Factory (browser.factory.ts)

| NODE_ENV | Mode | Chrome |
|----------|------|--------|
| development | Headed (visible) | Native Chrome installation |
| production/test | Headless | Bundled Chromium |

Detects Chrome paths for Windows, macOS, Linux. Throws descriptive error if not found in dev mode.

---

## Data Persistence

| Data | File | Survives restart? |
|------|------|-------------------|
| Test cases | `data/test-cases.json` | Yes |
| Auth config | `data/auth.json` | Yes |
| Action cache | `cache/actions.json` | Yes |
| Job queue | Redis | Yes (until Redis restarts) |

On restart, test cases with status "running"/"queued" are reset to "idle".

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/test-cases` | List all test cases |
| POST | `/api/test-cases` | Create test case |
| GET | `/api/test-cases/:id` | Get single test case |
| PUT | `/api/test-cases/:id` | Update test case |
| DELETE | `/api/test-cases/:id` | Delete test case |
| POST | `/api/test-cases/:id/execute` | Trigger execution (202) |
| GET | `/api/jobs/:jobId` | Get job status |
| DELETE | `/api/cache` | Clear action cache |
| GET | `/api/cache/stats` | Cache statistics |
| GET | `/api/auth` | Get auth config |
| PUT | `/api/auth` | Save auth config |
| DELETE | `/api/auth` | Clear auth config |
| GET | `/` | Dashboard HTML |

---

## How to Extend

### Add a new action type (e.g., "Hover")

1. Edit `automation.service.ts` → `executeAction()` method
2. Add detection: `const startsWithHover = /^(?:\d+\.\s*)?hover/i.test(instruction);`
3. Add handler: `if (startsWithHover) { await page.hover(selector); }`

### Add a new special instruction (e.g., "Scroll down")

1. Edit `automation.service.ts` → `handleSpecialInstruction()` method
2. Add pattern match: `if (lower.includes('scroll'))` 
3. Add handler: `await page.evaluate('window.scrollBy(0, 500)'); return true;`

### Add a new AI provider (e.g., OpenAI)

1. Edit `ai.service.ts`
2. Add detection in constructor: `if (process.env.OPENAI_API_KEY)`
3. Add `invokeOpenAI()` method similar to `invokeAnthropicDirect()`
4. Route in `invokeModel()` based on provider

### Add a new PrimeReact component handler

1. For wait: Edit `handleSpecialInstruction()` → add selector pattern
2. For action: Edit `executeAction()` → add component-specific logic (like Select does for dropdowns)

### Change the DOM extraction strategy

Edit `getAiMapping()` → modify the `page.evaluate()` string to include/exclude different elements or attributes.

### Add test case tagging/grouping

1. Add `tags: string[]` to `TestCaseResponse` interface
2. Add to `CreateTestCaseDto` with validation
3. Update `test-cases.service.ts` CRUD
4. Add filter UI in dashboard

---

## Running

### Option 1: Native (for development — headed Chrome, watch tests execute)

```bash
cd e2e-testing
npm install
npm run start
# Open http://localhost:3005
```

Prerequisites: Node.js 20+, Redis running, Chrome installed, `.env` configured.

### Option 2: Docker local build (test the Docker image)

```bash
cd e2e-testing
npm run docker:build
# Open http://localhost:3005
# Stop: npm run docker:stop
```

Prerequisites: Docker Desktop only.

### Option 3: Docker pull (for QA testers — no code needed)

```bash
cd e2e-testing-runner   # shared folder
# Double-click run.bat, or:
docker compose pull
docker compose up -d
# Open http://localhost:3005
```

Prerequisites: Docker Desktop only.

---

## Docker Architecture

```
┌─────────────────────────────────────────┐
│  Developer Machine                       │
│                                          │
│  push to main → GitHub Action →          │
│  builds image → pushes to ECR Public     │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  QA Tester Machine                       │
│                                          │
│  run.bat → docker compose pull →         │
│  pulls from ECR Public → starts app     │
│                                          │
│  ┌─── Docker Network ───────────────┐   │
│  │  redis (port 6379 internal)      │   │
│  │  app (port 3005 → host:3005)     │   │
│  │  ↕ can reach host.docker.internal│   │
│  │  ↕ can reach internet URLs       │   │
│  └──────────────────────────────────┘   │
│                                          │
│  .env (secrets — never in image)         │
│  data/ (test cases — persisted locally)  │
│  cache/ (AI cache — persisted locally)   │
└─────────────────────────────────────────┘
```

### Files structure for testers (shared folder)

```
e2e-testing-runner/
├── docker-compose.yml    ← points to ECR Public image
├── .env                  ← Anthropic API key + config
├── run.bat               ← double-click to start
├── stop.bat              ← double-click to stop
├── data/                 ← auto-created (test cases persist)
└── cache/                ← auto-created (AI selector cache)
```

### Target URL when testing local apps from Docker

Inside Docker, `localhost` refers to the container. To reach apps on the host:

| Target | URL |
|--------|-----|
| Internet (production) | `https://admin.clinicoz.com/cms/login` |
| Host machine app | `http://host.docker.internal:4200` |
| Another Docker container | Use the service name |

### CI/CD Pipeline (.github/workflows/deploy-e2e.yml)

Triggers on push to `main` when `e2e-testing/` or the workflow file changes:
1. Builds Docker image from `e2e-testing/Dockerfile`
2. Logs in to ECR Public (us-east-1 — required for ECR Public auth)
3. Pushes image tagged as `:latest` and `:$GITHUB_SHA`

Required GitHub Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| NODE_ENV | Yes | — | development / production / test |
| PORT | No | 3000 | Server port |
| REDIS_HOST | No | 127.0.0.1 | Redis host (use `redis` in Docker) |
| REDIS_PORT | No | 6379 | Redis port |
| ANTHROPIC_API_KEY | Yes | — | Anthropic API key for AI element mapping |
| ANTHROPIC_MODEL | No | claude-3-5-haiku-20241022 | Model to use |

---

## AI Service (ai.service.ts)

Uses **Anthropic API directly** (api.anthropic.com). No AWS/Bedrock dependency.

- Requires `ANTHROPIC_API_KEY` environment variable
- Model configurable via `ANTHROPIC_MODEL` env var
- Retry logic: max 2 retries on 5xx errors, no retry on 4xx
- DOM context sent as interactive elements list (not full HTML)

---

## TODO / Future Enhancements

### Variable System (`$variable` support)

**Priority:** High — enables create-then-delete test patterns

**Concept:** Allow testers to store generated values and reuse them later in the same test run.

**Syntax:**
```
Type random name as $patientName in input[data-testid="name-input"]
Type $patientName in input[data-testid="search-input"]
```

**Implementation plan:**
1. Add a `variables: Map<string, string>` to the test execution context (pass through `executeStep`)
2. In `resolveValue()`, detect `as $varName` pattern → generate value, store in map, return value
3. Before resolving any value, check if the text is `$varName` → look up in map
4. Variables are scoped to a single test case execution (cleared between runs)

**Files to modify:**
- `automation.service.ts` → `executeTestCase()` (create map), `executeStep()` (pass map), `resolveValue()` (store/retrieve)

### Assertion Steps

**Concept:** Allow testers to assert element text/value matches expected:
```
Assert text of [data-testid="patient-name"] equals "Test David Kumar"
Assert value of input#email contains "@"
Assert element [data-testid="error-msg"] is not visible
```

### Test Case Groups / Suites

**Concept:** Group test cases and run them sequentially as a suite with shared auth.

### Screenshot on Failure ✅ IMPLEMENTED

Captures a full-page screenshot when a step fails and displays it in the Details modal.

**How it works:**
1. In `automation.service.ts` → `executeStep()` catch block
2. Calls `page.screenshot({ path, fullPage: true })` 
3. Saves to `data/screenshots/step-{index}-{timestamp}.png`
4. Filename stored in `StepResult.screenshot` field
5. Served via `GET /api/screenshots/:filename` endpoint (execution.controller.ts)
6. Dashboard modal renders `<img>` tag below the error message

**Files involved:**
- `src/automation/automation.service.ts` — capture logic in catch block
- `src/execution/execution.controller.ts` — `GET /api/screenshots/:filename` endpoint
- `src/test-cases/dto/test-case-response.dto.ts` — `screenshot?: string` field in StepResult
- `public/index.html` — modal renders screenshot image

**Storage:** `data/screenshots/` (persisted via Docker volume mount)

### Parallel Test Execution (Multi-browser)

**Concept:** For larger EC2 instances, allow concurrency > 1 with multiple browser instances.

---

## Troubleshooting for Developers

| Issue | Cause | Fix |
|-------|-------|-----|
| `Cannot find name 'document'` | Code inside `page.evaluate()` | Use string-based evaluate, not arrow function |
| `AUTOMATION_SERVICE` not found | Module not imported | Ensure ExecutionModule imports AutomationModule |
| ConfigService undefined | Using tsx instead of ts-node | Use `ts-node server.ts` (supports emitDecoratorMetadata) |
| Port already in use | Previous instance running | Kill process on that port |
| Redis connection refused | Redis not running | Start Redis: `docker run -d -p 6379:6379 redis:alpine` |
| Browser launch failed | Chrome not found | Install Chrome or check BrowserFactory paths |
| Action cache corrupt | Bad JSON | Delete `cache/actions.json`, restart |
