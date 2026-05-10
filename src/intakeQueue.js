const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const defaultQueuePath = path.resolve("data/lead-intake-events.json");
const eventType = "lead_intake.created";
const eventVersion = "1";

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function compactHash(value, length = 16) {
  return sha256(value).slice(0, length);
}

function normalizeKeyPart(value, fallback = "unknown") {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return text || fallback;
}

function normalizePhoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || "no-phone";
}

function findFirstRawValue(value, keys) {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const foundValue = findFirstRawValue(item, keys);
      if (foundValue) return foundValue;
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (keys.has(normalizedKey) && entryValue !== null && entryValue !== undefined && String(entryValue).trim()) {
      return String(entryValue).trim();
    }

    const foundValue = findFirstRawValue(entryValue, keys);
    if (foundValue) return foundValue;
  }

  return "";
}

function getVendorLeadId(rawPayload = {}) {
  return findFirstRawValue(
    rawPayload,
    new Set([
      "id",
      "leadid",
      "lead_id",
      "vendorleadid",
      "vendor_lead_id",
      "uuid",
      "externalid",
      "external_id",
    ].map((key) => key.replace(/[^a-z0-9]/g, "")))
  );
}

function buildIdempotencyKey({ normalizedPayload, vendorLeadId }) {
  const structuredData = normalizedPayload.structured_data || {};
  const source = normalizeKeyPart(structuredData.contact_source || structuredData.source, "unknown-source");
  const leadId = normalizeKeyPart(vendorLeadId, "no-vendor-id");
  const phone = normalizePhoneKey(structuredData.phone);
  const propertyHash = compactHash(
    [
      structuredData.property_address,
      structuredData.city,
      structuredData.state,
      structuredData.postal_code,
    ]
      .filter(Boolean)
      .join("|") || stableStringify(normalizedPayload.raw_webhook_payload || {})
  );

  return `${source}:${leadId}:${phone}:${propertyHash}`;
}

function buildLeadIntakeEvent({
  normalizedPayload = {},
  cleanNotes = "",
  crmForwardStatus = "unknown",
  crmResponseStatus = null,
  receivedAt = new Date().toISOString(),
} = {}) {
  const rawPayload = normalizedPayload.raw_webhook_payload || {};
  const structuredData = normalizedPayload.structured_data || {};
  const vendorLeadId = getVendorLeadId(rawPayload);
  const idempotencyKey = buildIdempotencyKey({ normalizedPayload, vendorLeadId });

  return {
    eventId: compactHash(`${eventType}:${eventVersion}:${idempotencyKey}`, 24),
    eventType,
    eventVersion,
    idempotencyKey,
    receivedAt,
    source: structuredData.contact_source || structuredData.source || "",
    vendorLeadId,
    structuredData,
    cleanNotes,
    unmappedData: normalizedPayload.unmapped_data || {},
    rawPayloadHash: sha256(stableStringify(rawPayload)),
    crmForwardStatus,
    crmResponseStatus,
    processingStatus: "queued",
  };
}

function ensureQueueDir(queuePath) {
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
}

function readQueue(queuePath = defaultQueuePath) {
  if (!fs.existsSync(queuePath)) {
    return [];
  }

  const text = fs.readFileSync(queuePath, "utf8").trim();
  if (!text) {
    return [];
  }

  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

function writeQueue(events, queuePath = defaultQueuePath) {
  ensureQueueDir(queuePath);
  const tempPath = `${queuePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(events, null, 2)}\n`);
  fs.renameSync(tempPath, queuePath);
}

function enqueueLeadIntakeEvent(event, options = {}) {
  const queuePath = options.queuePath || process.env.INTAKE_QUEUE_PATH || defaultQueuePath;
  const queue = readQueue(queuePath);
  const duplicate = queue.find((item) => item.idempotencyKey === event.idempotencyKey);

  if (duplicate) {
    return {
      status: "duplicate",
      enqueued: false,
      event: duplicate,
      queuePath,
    };
  }

  queue.push(event);
  writeQueue(queue, queuePath);

  return {
    status: "queued",
    enqueued: true,
    event,
    queuePath,
  };
}

function inspectQueue(queuePath = process.env.INTAKE_QUEUE_PATH || defaultQueuePath) {
  const queue = readQueue(queuePath);
  const statusCounts = queue.reduce((counts, event) => {
    const status = event.processingStatus || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  return {
    queuePath,
    total: queue.length,
    statusCounts,
    events: queue,
  };
}

function getPendingEvents(queuePath = process.env.INTAKE_QUEUE_PATH || defaultQueuePath) {
  return readQueue(queuePath).filter((event) =>
    ["queued", "pending"].includes(String(event.processingStatus || "").toLowerCase())
  );
}

function markEventProcessed(eventId, options = {}) {
  const queuePath = options.queuePath || process.env.INTAKE_QUEUE_PATH || defaultQueuePath;
  const queue = readQueue(queuePath);
  const eventIndex = queue.findIndex((event) => event.eventId === eventId);

  if (eventIndex === -1) {
    return {
      status: "not_found",
      updated: false,
      event: null,
      queuePath,
    };
  }

  const now = options.processedAt || new Date().toISOString();
  const event = {
    ...queue[eventIndex],
    processingStatus: "processed",
    processedAt: queue[eventIndex].processedAt || now,
    updatedAt: now,
  };
  queue[eventIndex] = event;
  writeQueue(queue, queuePath);

  return {
    status: "processed",
    updated: true,
    event,
    queuePath,
  };
}

function dedupeQueue(queuePath = process.env.INTAKE_QUEUE_PATH || defaultQueuePath) {
  const queue = readQueue(queuePath);
  const seen = new Set();
  const deduped = [];
  const duplicates = [];

  for (const event of queue) {
    if (seen.has(event.idempotencyKey)) {
      duplicates.push(event);
      continue;
    }

    seen.add(event.idempotencyKey);
    deduped.push(event);
  }

  if (duplicates.length) {
    writeQueue(deduped, queuePath);
  }

  return {
    queuePath,
    before: queue.length,
    after: deduped.length,
    duplicatesRemoved: duplicates.length,
  };
}

module.exports = {
  buildIdempotencyKey,
  buildLeadIntakeEvent,
  dedupeQueue,
  defaultQueuePath,
  enqueueLeadIntakeEvent,
  eventType,
  eventVersion,
  getPendingEvents,
  getVendorLeadId,
  inspectQueue,
  markEventProcessed,
  readQueue,
  stableStringify,
  writeQueue,
};
