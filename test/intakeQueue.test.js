const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  buildLeadIntakeEvent,
  dedupeQueue,
  enqueueLeadIntakeEvent,
  inspectQueue,
  readQueue,
  writeQueue,
} = require("../src/intakeQueue");

function queuePathFor(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ppl-intake-queue-")), `${name}.json`);
}

function sampleNormalizedPayload(overrides = {}) {
  return {
    structured_data: {
      name: "Test Seller",
      phone: "+15555551212",
      email: "seller@example.com",
      property_address: "123 Test St",
      asking_price: "200000",
      timeline: "30 days",
      motivation: "Tired landlord",
      source: "Speed to Lead",
      contact_source: "Speed to Lead",
      city: "Dallas",
      state: "TX",
      postal_code: "75201",
      ...(overrides.structured_data || {}),
    },
    unmapped_data: {
      repairs: "Roof and flooring",
      ...(overrides.unmapped_data || {}),
    },
    raw_webhook_payload: {
      id: "vendor-123",
      source: "Speed to Lead",
      ...(overrides.raw_webhook_payload || {}),
    },
    data_quality_score: 80,
  };
}

test("creates a durable lead intake event", () => {
  const event = buildLeadIntakeEvent({
    normalizedPayload: sampleNormalizedPayload(),
    cleanNotes: "Inbound Lead Details:\n- summary: Useful details",
    crmForwardStatus: "accepted",
    crmResponseStatus: 202,
    receivedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.strictEqual(event.eventType, "lead_intake.created");
  assert.strictEqual(event.eventVersion, "1");
  assert.strictEqual(event.source, "Speed to Lead");
  assert.strictEqual(event.vendorLeadId, "vendor-123");
  assert.strictEqual(event.processingStatus, "queued");
  assert.strictEqual(event.crmForwardStatus, "accepted");
  assert.strictEqual(event.crmResponseStatus, 202);
  assert.match(event.idempotencyKey, /^speed-to-lead:vendor-123:15555551212:/);
  assert.match(event.rawPayloadHash, /^[a-f0-9]{64}$/);
});

test("uses deterministic idempotency keys", () => {
  const first = buildLeadIntakeEvent({ normalizedPayload: sampleNormalizedPayload() });
  const second = buildLeadIntakeEvent({ normalizedPayload: sampleNormalizedPayload() });

  assert.strictEqual(first.idempotencyKey, second.idempotencyKey);
  assert.strictEqual(first.eventId, second.eventId);
});

test("suppresses duplicate queue events", () => {
  const queuePath = queuePathFor("duplicates");
  const event = buildLeadIntakeEvent({ normalizedPayload: sampleNormalizedPayload() });

  const first = enqueueLeadIntakeEvent(event, { queuePath });
  const second = enqueueLeadIntakeEvent(event, { queuePath });

  assert.strictEqual(first.status, "queued");
  assert.strictEqual(first.enqueued, true);
  assert.strictEqual(second.status, "duplicate");
  assert.strictEqual(second.enqueued, false);
  assert.strictEqual(readQueue(queuePath).length, 1);
});

test("persists queue events to disk", () => {
  const queuePath = queuePathFor("persistence");
  const event = buildLeadIntakeEvent({ normalizedPayload: sampleNormalizedPayload() });

  enqueueLeadIntakeEvent(event, { queuePath });

  const persisted = readQueue(queuePath);
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].eventId, event.eventId);

  const summary = inspectQueue(queuePath);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.statusCounts.queued, 1);
});

test("handles malformed or sparse payloads without throwing", () => {
  const event = buildLeadIntakeEvent({
    normalizedPayload: {
      structured_data: {},
      raw_webhook_payload: "not an object",
    },
    crmForwardStatus: "skipped",
  });

  assert.strictEqual(event.source, "");
  assert.strictEqual(event.vendorLeadId, "");
  assert.match(event.idempotencyKey, /^unknown-source:no-vendor-id:no-phone:/);
  assert.match(event.rawPayloadHash, /^[a-f0-9]{64}$/);
});

test("dedupes an existing queue file", () => {
  const queuePath = queuePathFor("dedupe");
  const event = buildLeadIntakeEvent({ normalizedPayload: sampleNormalizedPayload() });
  writeQueue([event, { ...event, eventId: "duplicate-event-id" }], queuePath);

  const result = dedupeQueue(queuePath);

  assert.strictEqual(result.before, 2);
  assert.strictEqual(result.after, 1);
  assert.strictEqual(result.duplicatesRemoved, 1);
  assert.strictEqual(readQueue(queuePath).length, 1);
});
