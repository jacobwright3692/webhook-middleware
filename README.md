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

CRM notes are formatted as acquisitions intelligence instead of raw intake dumps. New notes start with a `Quick Read`, then only include non-empty useful sections such as seller summary, property summary, motivation/timeline, condition, price, occupancy, financial signals, contact preferences, source information, flags, and follow-up guidance.

## Lead Intake Queue

After a lead is normalized and the CRM forward is attempted, the webhook writes a durable local event to `data/lead-intake-events.json`. This is only an async handoff foundation for future ARV-Agent-Fresh consumption; it does not trigger ARV research or browser automation.

```bash
npm run intake:queue:inspect
npm run intake:queue:dedupe
```

## Speed to Lead Note Cleanup

New Speed to Lead notes remove embedded recommended script blocks before forwarding to the CRM.

To preview cleanup for existing GoHighLevel contact notes:

```bash
GHL_API_TOKEN=your_private_integration_token GHL_LOCATION_ID=your_location_id npm run cleanup:speed-script
```

Token aliases are supported in this priority order: `GHL_API_TOKEN`, `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_ACCESS_TOKEN`, `HIGHLEVEL_API_KEY`, `GOHIGHLEVEL_API_KEY`. Location ID aliases are `GHL_LOCATION_ID`, `LOCATION_ID`, and `GHL_SUBACCOUNT_ID`; if none are set, the script can derive the location ID from `CRM_WEBHOOK_URL`.

The cleanup scans contact notes and the Inbound Lead Details custom field. If the field cannot be resolved by name/key, provide the exact field ID:

```bash
GHL_API_TOKEN=your_private_integration_token GHL_LOCATION_ID=your_location_id GHL_INBOUND_LEAD_DETAILS_FIELD_ID=your_field_id npm run cleanup:speed-script
```

To run against one contact:

```bash
GHL_API_TOKEN=your_private_integration_token GHL_LOCATION_ID=your_location_id npm run cleanup:speed-script -- --contact-id=contact_id
```

To apply updates after reviewing the dry-run output:

```bash
GHL_API_TOKEN=your_private_integration_token GHL_LOCATION_ID=your_location_id node scripts/cleanup-speed-to-lead-notes.js --live
```

If you have the exact repeated script text, place it in a file and pass `--exact-script-file=path/to/script.txt` for the safest match. Empty notes are skipped by default; pass `--delete-empty` with `--live` only if you want notes containing nothing but the unwanted script removed.

## Historical Note Remediation Preview

To standardize old exported notes without touching CRM records, export the source records to JSON and run:

```bash
npm run notes:remediate:preview -- --input=path/to/export.json --output=data/note-remediation-preview.json
```

This generates preview-only standardized notes and preserves the original note text in the output. The utility intentionally rejects `--live`; CRM overwrites should be reviewed and handled as a separate, explicit workflow.
