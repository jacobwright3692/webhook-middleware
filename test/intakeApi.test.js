const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

process.env.INTAKE_QUEUE_API_TOKEN = "test-token";

const {
  handleMarkIntakeEventProcessed,
  handlePendingIntakeEvents,
} = require("../src/server");
const { buildLeadIntakeEvent, writeQueue } = require("../src/intakeQueue");

function queuePathFor(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ppl-intake-api-")), `${name}.json`);
}

function sampleEvent(id, processingStatus = "queued") {
  return {
    ...buildLeadIntakeEvent({
      normalizedPayload: {
        structured_data: {
          name: "API Test Seller",
          phone: "+15550104444",
          property_address: "44 API Test Rd",
          source: "Speed to Lead",
          contact_source: "Speed to Lead",
          city: "Dallas",
          state: "TX",
          postal_code: "75201",
        },
        unmapped_data: {},
        raw_webhook_payload: { id, source: "Speed to Lead" },
      },
      cleanNotes: "Inbound Lead Details:\n- summary: API test",
    }),
    processingStatus,
  };
}

function createResponse() {
  return {
    body: null,
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("pending intake endpoint requires bearer token", async () => {
  const queuePath = queuePathFor("unauthorized");
  process.env.INTAKE_QUEUE_PATH = queuePath;
  writeQueue([sampleEvent("unauthorized")], queuePath);

  const res = createResponse();
  handlePendingIntakeEvents({ headers: {} }, res);

  assert.strictEqual(res.statusCode, 401);
});

test("pending intake endpoint returns queued events with valid token", async () => {
  const queuePath = queuePathFor("pending");
  process.env.INTAKE_QUEUE_PATH = queuePath;
  writeQueue([sampleEvent("queued"), sampleEvent("processed", "processed")], queuePath);

  const res = createResponse();
  handlePendingIntakeEvents({ headers: { authorization: "Bearer test-token" } }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, "ok");
  assert.strictEqual(res.body.count, 1);
  assert.strictEqual(res.body.events[0].processingStatus, "queued");
});

test("processed endpoint marks event processed with valid token", async () => {
  const queuePath = queuePathFor("processed");
  process.env.INTAKE_QUEUE_PATH = queuePath;
  const event = sampleEvent("mark-processed");
  writeQueue([event], queuePath);

  const res = createResponse();
  handleMarkIntakeEventProcessed(
    {
      headers: { authorization: "Bearer test-token" },
      params: { eventId: event.eventId },
    },
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, "processed");
  assert.strictEqual(res.body.eventId, event.eventId);
  assert.strictEqual(res.body.processingStatus, "processed");
});

test("processed endpoint returns 404 for missing event", async () => {
  const queuePath = queuePathFor("missing");
  process.env.INTAKE_QUEUE_PATH = queuePath;
  writeQueue([], queuePath);

  const res = createResponse();
  handleMarkIntakeEventProcessed(
    {
      headers: { authorization: "Bearer test-token" },
      params: { eventId: "missing-event" },
    },
    res
  );

  assert.strictEqual(res.statusCode, 404);
});
