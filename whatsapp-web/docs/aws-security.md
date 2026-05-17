# AWS Security Setup — WhatsApp Microservice

This document covers network security configuration for the WhatsApp microservice infrastructure using AWS Security Groups.

---

## Architecture Overview

```
Internet → Backend MS (public) → WhatsApp MS (private port)
                               → Database (private port)
```

The WhatsApp MS and Database are not publicly accessible on their service ports. Only the Backend MS can communicate with them internally via the VPC.

---

## Security Groups

### Backend MS (`sg-backend`)

| Type | Port | Source | Purpose |
|---|---|---|---|
| Inbound | 80/443 | 0.0.0.0/0 | Public API traffic |
| Inbound | 22 | Your office IP | SSH access |
| Outbound | All | 0.0.0.0/0 | Default (allow all outbound) |

---

### WhatsApp MS (`sg-whatsapp`)

| Type | Port | Source | Purpose |
|---|---|---|---|
| Inbound | 3001 | `sg-backend` | Only Backend MS can call WhatsApp API |
| Inbound | 22 | Your office IP | SSH for maintenance/deploys |
| Inbound | 22 | GitHub Actions IPs | SSH for CI/CD deploys |
| Outbound | All | 0.0.0.0/0 | Chromium needs internet for WhatsApp Web |

---

### Database (`sg-database`)

| Type | Port | Source | Purpose |
|---|---|---|---|
| Inbound | 5432 | `sg-backend` | Only Backend MS can access Postgres |
| Inbound | 22 | Your office IP | SSH for maintenance |
| Outbound | All | 0.0.0.0/0 | Default |

---

## Why Security Group References (not IPs)

Security group rules should reference the **Security Group ID** of the source instance rather than specific IPs:

```
Inbound rule: Allow port 3001 from sg-backend
```

Benefits:
- If you replace an instance, the new one inherits the same SG — no rule updates needed
- Works with auto-scaling if you ever add it
- No need to update rules when Elastic IPs change

---

## Elastic IPs

| Instance | Elastic IP | Purpose |
|---|---|---|
| Backend MS | Yes | Public-facing, stable DNS |
| WhatsApp MS | Yes | Stable address for deploy workflow + backend config |
| Database | Optional | Only needed if accessed from outside VPC |

Elastic IPs are free while attached to a running instance. They only cost money if unattached.

---

## Private vs Public Communication

All inter-service traffic should use **private IPs** within the VPC:

- Backend MS → WhatsApp MS: use private IP (e.g., `10.0.1.x:3001`)
- Backend MS → Database: use private IP (e.g., `10.0.1.x:5432`)

Private IP advantages:
- Traffic stays within AWS network (faster, no internet hop)
- Private IPs don't change on stop/start (they're static by default in a VPC)
- Not exposed to the internet at all

Use Elastic IPs (public) only for:
- SSH access from outside (your office, GitHub Actions)
- Public-facing services (Backend MS API)

---

## GitHub Actions Deploy Access

The deploy workflow needs SSH access to the WhatsApp MS. Options:

**Option 1: Allow GitHub Actions IP ranges (recommended)**

GitHub publishes their Actions IP ranges. Add them to the SSH inbound rule:
- Source: GitHub Actions IP ranges (see https://api.github.com/meta → `actions` key)
- Downside: IP ranges change occasionally

**Option 2: Allow 0.0.0.0/0 on port 22 with key-only auth**

- Simpler but less secure
- Acceptable if SSH key is strong and password auth is disabled

**Option 3: Use a bastion/jump host**

- Most secure but adds complexity
- Overkill for this scale

---

## Checklist

- [ ] Assign Elastic IP to WhatsApp MS instance
- [ ] Create `sg-whatsapp` security group
- [ ] Add inbound rule: port 3001 from `sg-backend`
- [ ] Add inbound rule: port 22 from your office IP
- [ ] Remove any default 0.0.0.0/0 rules on port 3001
- [ ] Update Backend MS config to use WhatsApp MS private IP for API calls
- [ ] Update deploy workflow `EC2_HOST` with the Elastic IP
- [ ] Verify Backend MS can reach WhatsApp MS on port 3001
- [ ] Verify WhatsApp MS rejects connections from other sources on port 3001
