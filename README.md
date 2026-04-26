# Webhook Middleware Agent

Backend-only Node.js Express service for receiving lead webhooks, normalizing payloads, mapping data toward CRM fields, and forwarding cleaned payloads to a CRM webhook endpoint.

## Routes

- `GET /health` - health check
- `POST /webhook/lead` - lead webhook intake endpoint

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Set `CRM_WEBHOOK_URL` in `.env` before sending lead webhooks.

## Environment

```bash
PORT=3000
CRM_WEBHOOK_URL=https://example.com/crm/webhook
```

## Notes

This project intentionally does not include a CRM implementation or frontend. The `normalizeLeadPayload()` and `forwardToCRM()` functions are placeholders for future source-specific cleanup, CRM field mapping, and outbound webhook forwarding.
