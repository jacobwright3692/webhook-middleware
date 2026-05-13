#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { buildOutboundCrmPayload, normalizeLeadPayload } = require("../src/server");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolvePayload(record) {
  if (!record || typeof record !== "object") return {};
  return (
    record.rawPayload ||
    record.raw_webhook_payload ||
    record.payload ||
    record.body ||
    record.webhookPayload ||
    record
  );
}

function resolveOriginalNote(record) {
  if (!record || typeof record !== "object") return "";
  return record.originalNote || record.note || record.notes || record.bodyText || "";
}

function remediateRecords(records) {
  return records.map((record, index) => {
    const payload = resolvePayload(record);
    const normalized = normalizeLeadPayload(payload);
    const crmPayload = buildOutboundCrmPayload(normalized);
    const originalNote = resolveOriginalNote(record);

    return {
      index,
      contactId: record.contactId || record.contact_id || "",
      noteId: record.noteId || record.note_id || "",
      source: normalized.structured_data.contact_source || normalized.structured_data.source || "",
      changed: Boolean(originalNote && originalNote.trim() !== crmPayload.notes.trim()),
      originalNote,
      standardizedNote: crmPayload.notes,
      preservationMode: "preview_only_no_crm_write",
    };
  });
}

function main() {
  if (hasFlag("live")) {
    throw new Error("Live CRM writes are intentionally not supported by this remediation preview utility.");
  }

  const inputPath = getArg("input");
  if (!inputPath) {
    throw new Error("Usage: node scripts/remediate-crm-notes.js --input=path/to/export.json [--output=path/to/preview.json]");
  }

  const outputPath = getArg("output", path.resolve("data/note-remediation-preview.json"));
  const input = readJson(inputPath);
  const records = Array.isArray(input) ? input : input.records || input.notes || input.contacts || [];
  if (!Array.isArray(records)) {
    throw new Error("Input must be a JSON array or an object with records, notes, or contacts array.");
  }

  const preview = remediateRecords(records);
  writeJson(outputPath, preview);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "dry-run",
        inputPath,
        outputPath,
        recordsScanned: records.length,
        standardizedNotesGenerated: preview.length,
        changed: preview.filter((item) => item.changed).length,
        crmWrites: 0,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  remediateRecords,
  resolveOriginalNote,
  resolvePayload,
};
