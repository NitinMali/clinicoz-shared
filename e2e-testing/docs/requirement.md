# Clinicoz E2E Automation Hub: Architecture & Technical Requirements

This document specifies the environment configuration, codebase layout, and infrastructure deployment guide for the **Clinicoz Natural Language E2E Testing Engine**. 

The architecture is explicitly designed to support local developer workflow iteration while offering a **zero-configuration web portal interface** for manual QA testers, fully optimized to run within the constraints of an AWS EC2 `t3.small` instance.

---

## 🏛️ System Architecture

The architecture consists of a Node.js service backed by a Redis task queue. This dual-layer approach decouples the incoming HTTP API request from the long-running browser processes, enforcing strict sequential execution to respect memory limitations.

### Core Component Breakdown
1. **Frontend Dashboard:** A single-page, zero-dependency dashboard built with clean semantic HTML/CSS that lists test cases and statuses, polling the server automatically for real-time progress updates.
2. **REST API & Job Queue (Redis / BullMQ):** Nest js accepts execution commands and safely records them into Redis. BullMQ handles sequential execution (`concurrency: 1`) to ensure only one browser instance is running at any given moment.
3. **AI Core (Amazon Bedrock):** Utilizes Anthropic Claude 3.5 Sonnet to map plain-text instructions directly to interactive web page elements.
4. **Automation Engine (Stagehand + Playwright):** Runs the local system browser in headless mode on the server, leveraging built-in **Action Caching** to avoid redundant LLM calls on repeated regression runs.

---

## 🛠️ Local Development Setup (For Developers)

Developers build, test, and refine natural language action paths locally on their machines with a visible graphical user interface (GUI) browser.

### 1. System Prerequisites
* **Node.js:** v20.x or v22.x (LTS)
* **Redis Server:** Running locally via Docker or native package manager (needed for the local background job workers).
* **Browser:** Native Google Chrome installed on the host operating system.

### 3. Environment Configuration (`.env`)
Create a `.env` file in the root folder of your project setup:
```bash
NODE_ENV=development
PORT=3000

# Local Redis Connection Details
REDIS_HOST=127.0.0.1
REDIS_PORT=6321

# AWS IAM Credentials for Bedrock Model Invocation
AWS_ACCESS_KEY_ID="your_dev_access_key_id"
AWS_SECRET_ACCESS_KEY="your_dev_secret_access_key"
AWS_REGION="us-east-1"
```

### 4. Running the App Locally
Start the development API and worker service:
```bash
npx tsx server.ts
```
* **Expected Behavior:** The Nest js API binds to port `3000`. 
* When you click "Run" on the local portal, **Stagehand automatically triggers a visible Chrome window** on your screen, letting you watch the cursor select inputs, process dropdown animations, and verify page state changes in real-time.

---

## ☁️ QA Server Deployment Guide (EC2 `t3.small`)

The server configuration ensures that **QA personnel face zero local dependency friction**. They do not need to install Node.js, configure AWS access keys, or manage Git profiles. They simply interact with the central web interface.

## 🔒 Optimization & Platform Guardrails (`t3.small`)

1. **Strict Thread Locking:** The BullMQ configuration enforces `concurrency: 1`. This safely ensures that even if developers push multiple branch modifications or a QA tester triggers multiple tests simultaneously, only one system browser instance executes at a time. This keeps memory usage well within the instance's 2 GB limit.
2. **Persistent Caching Engine:** Stagehand retains a local JSON snapshot tracking mapping choices. Successful elements (e.g., specific search inputs or interactive login paths) are recorded straight to the EC2 storage. Subsequent test passes execute immediately via deterministic Playwright paths, significantly reducing AWS Bedrock utilization costs.
3. **Automated RAM Lifecycle Reclaiming:** The framework is explicitly structured with a mandatory `finally` catch handler that triggers `await stagehand.close()`. This guarantees that Chrome instances are completely purged from system memory after execution, preventing lingering zombie processes from exhausting the instance's RAM.