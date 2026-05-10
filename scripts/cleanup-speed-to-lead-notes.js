#!/usr/bin/env node

require("dotenv").config();

const {
  cleanSpeedToLeadRecommendedScript,
  containsSpeedToLeadRecommendedScript,
} = require("../src/noteCleaning");

const API_BASE_URL = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";
const TOKEN_ENV_NAMES = [
  "GHL_API_TOKEN",
  "GHL_PRIVATE_INTEGRATION_TOKEN",
  "GHL_ACCESS_TOKEN",
  "HIGHLEVEL_API_KEY",
  "GOHIGHLEVEL_API_KEY",
];
const LOCATION_ENV_NAMES = [
  "GHL_LOCATION_ID",
  "LOCATION_ID",
  "GHL_SUBACCOUNT_ID",
];
const INBOUND_DETAILS_FIELD_MATCHERS = [
  "inboundleaddetails",
  "leaddetails",
  "speedtoleaddetails",
];
const REDACTED_PREVIEW_LENGTH = 260;

function parseArgs(argv) {
  return argv.reduce(
    (args, arg) => {
      if (arg === "--live") {
        args.dryRun = false;
        return args;
      }

      if (arg === "--dry-run") {
        args.dryRun = true;
        return args;
      }

      if (arg === "--delete-empty") {
        args.deleteEmpty = true;
        return args;
      }

      if (arg.startsWith("--contact-id=")) {
        args.contactIds.push(arg.slice("--contact-id=".length));
        return args;
      }

      if (arg.startsWith("--limit=")) {
        args.limit = Number(arg.slice("--limit=".length));
        return args;
      }

      if (arg.startsWith("--exact-script-file=")) {
        args.exactScriptFile = arg.slice("--exact-script-file=".length);
        return args;
      }

      return args;
    },
    {
      contactIds: [],
      deleteEmpty: false,
      dryRun: true,
      exactScriptFile: "",
      limit: 100,
    }
  );
}

async function readExactScriptText(filePath) {
  if (!filePath) {
    return "";
  }

  const fs = require("fs/promises");
  return fs.readFile(filePath, "utf8");
}

function getFirstConfiguredEnv(env, names) {
  const name = names.find((envName) => Boolean(env[envName]));

  if (!name) {
    return {
      name: "",
      value: "",
    };
  }

  return {
    name,
    value: env[name],
  };
}

function deriveLocationIdFromWebhookUrl(webhookUrl) {
  const match = String(webhookUrl || "").match(/\/hooks\/([^/]+)\/webhook-trigger\//);

  return match ? match[1] : "";
}

function getGhlTokenConfig(env = process.env) {
  return getFirstConfiguredEnv(env, TOKEN_ENV_NAMES);
}

function getGhlLocationConfig(env = process.env) {
  const configuredLocation = getFirstConfiguredEnv(env, LOCATION_ENV_NAMES);

  if (configuredLocation.value) {
    return configuredLocation;
  }

  const derivedLocationId = deriveLocationIdFromWebhookUrl(env.CRM_WEBHOOK_URL);

  if (derivedLocationId) {
    return {
      name: "CRM_WEBHOOK_URL",
      value: derivedLocationId,
    };
  }

  return {
    name: "",
    value: "",
  };
}

function createGhlClient(token) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: API_VERSION,
  };

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    });
    const bodyText = await response.text();
    const body = bodyText ? JSON.parse(bodyText) : {};

    if (!response.ok) {
      throw new Error(body.message || body.error || `${options.method || "GET"} ${path} failed with ${response.status}`);
    }

    return body;
  }

  return { request };
}

function normalizeFieldIdentity(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isLikelyInboundLeadDetailsField(field) {
  const identities = [
    field.id,
    field.name,
    field.fieldKey,
    field.key,
    field.placeholder,
    field.label,
  ].map(normalizeFieldIdentity);

  return identities.some((identity) =>
    INBOUND_DETAILS_FIELD_MATCHERS.some((matcher) => identity.includes(matcher))
  );
}

function getCustomFieldValue(customField) {
  if (!customField) {
    return "";
  }

  if (customField.value !== undefined && customField.value !== null) {
    return String(customField.value);
  }

  if (customField.field_value !== undefined && customField.field_value !== null) {
    return String(customField.field_value);
  }

  return "";
}

function redactPreview(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?1?[\s().-]*(?:\d[\s().-]*){10,}/g, "[phone]")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]{2,60}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|cir|circle|blvd|boulevard|way|trl|trail|pl|place)\b/gi, "[address]")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g, "[name]")
    .slice(0, REDACTED_PREVIEW_LENGTH);
}

function buildChangeLog({ action, contactId, noteId, fieldId, fieldName, beforeValue, afterValue, dryRun }) {
  return {
    action: dryRun ? `dry-run:${action}` : action,
    contactId,
    noteId,
    fieldId,
    fieldName,
    beforeLength: String(beforeValue || "").length,
    afterLength: String(afterValue || "").length,
    beforePreview: redactPreview(beforeValue),
    afterPreview: redactPreview(afterValue),
  };
}

function extractCustomFieldsResponse(data) {
  if (Array.isArray(data.customFields)) {
    return data.customFields;
  }

  if (Array.isArray(data.customField)) {
    return data.customField;
  }

  if (Array.isArray(data.fields)) {
    return data.fields;
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

async function listLocationCustomFields(ghl, locationId) {
  const paths = [
    `/locations/${encodeURIComponent(locationId)}/customFields?model=contact`,
    `/locations/${encodeURIComponent(locationId)}/customFields`,
  ];

  for (const path of paths) {
    try {
      return extractCustomFieldsResponse(await ghl.request(path));
    } catch (error) {
      if (path === paths[paths.length - 1]) {
        throw error;
      }
    }
  }

  return [];
}

async function resolveInboundLeadDetailsField(ghl, locationId, configuredFieldId) {
  if (configuredFieldId) {
    return {
      id: configuredFieldId,
      name: "GHL_INBOUND_LEAD_DETAILS_FIELD_ID",
      resolvedFromEnv: true,
    };
  }

  if (!locationId) {
    throw new Error(
      "GHL_LOCATION_ID is required to discover the Inbound Lead Details custom field. Set GHL_INBOUND_LEAD_DETAILS_FIELD_ID to skip discovery."
    );
  }

  const fields = await listLocationCustomFields(ghl, locationId);
  const matches = fields.filter(isLikelyInboundLeadDetailsField);

  if (matches.length !== 1) {
    throw new Error(
      `Could not safely identify the Inbound Lead Details custom field. Found ${matches.length} likely matches. Set GHL_INBOUND_LEAD_DETAILS_FIELD_ID to the exact custom field ID.`
    );
  }

  return matches[0];
}

async function listContacts(ghl, locationId, limit) {
  const contacts = [];
  let page = 1;

  while (contacts.length < limit) {
    const pageLimit = Math.min(100, limit - contacts.length);
    const data = await ghl.request(
      `/contacts/?locationId=${encodeURIComponent(locationId)}&limit=${pageLimit}&page=${page}`
    );
    const pageContacts = Array.isArray(data.contacts) ? data.contacts : [];

    contacts.push(...pageContacts);

    if (pageContacts.length < pageLimit) {
      break;
    }

    page += 1;
  }

  return contacts;
}

async function getContact(ghl, contactId) {
  const data = await ghl.request(`/contacts/${encodeURIComponent(contactId)}`);

  return data.contact || data;
}

function getNoteBody(note) {
  return note.body || note.note || note.notes || note.message || "";
}

async function listContactNotes(ghl, contactId) {
  const data = await ghl.request(`/contacts/${encodeURIComponent(contactId)}/notes`);
  return Array.isArray(data.notes) ? data.notes : [];
}

async function updateContactNote(ghl, contactId, noteId, body) {
  return ghl.request(`/contacts/${encodeURIComponent(contactId)}/notes/${encodeURIComponent(noteId)}`, {
    method: "PUT",
    body: JSON.stringify({ body }),
  });
}

async function deleteContactNote(ghl, contactId, noteId) {
  return ghl.request(`/contacts/${encodeURIComponent(contactId)}/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
}

function findContactCustomField(contact, fieldId) {
  return (contact.customFields || []).find((customField) => customField.id === fieldId);
}

async function updateContactCustomField(ghl, contactId, fieldId, value) {
  return ghl.request(`/contacts/${encodeURIComponent(contactId)}`, {
    method: "PUT",
    body: JSON.stringify({
      customFields: [
        {
          id: fieldId,
          field_value: value,
        },
      ],
    }),
  });
}

async function cleanContactNotes({ args, ghl, contact, exactScriptText }) {
  const contactId = contact.id;
  const notes = await listContactNotes(ghl, contactId);
  const stats = {
    scanned: notes.length,
    matched: 0,
    updated: 0,
    deleted: 0,
    skippedEmpty: 0,
  };

  for (const note of notes) {
    const noteId = note.id;
    const currentBody = getNoteBody(note);

    if (!containsSpeedToLeadRecommendedScript(currentBody, { exactScriptText })) {
      continue;
    }

    const cleanedBody = cleanSpeedToLeadRecommendedScript(currentBody, { exactScriptText });
    const action = cleanedBody ? "update-note" : args.deleteEmpty ? "delete-note" : "skip-empty-note";
    stats.matched += 1;

    console.log(
      JSON.stringify(
        buildChangeLog({
          action,
          contactId,
          noteId,
          beforeValue: currentBody,
          afterValue: cleanedBody,
          dryRun: args.dryRun,
        })
      )
    );

    if (args.dryRun || action === "skip-empty-note") {
      if (action === "skip-empty-note") {
        stats.skippedEmpty += 1;
      }
      continue;
    }

    if (action === "delete-note") {
      await deleteContactNote(ghl, contactId, noteId);
      stats.deleted += 1;
    } else {
      await updateContactNote(ghl, contactId, noteId, cleanedBody);
      stats.updated += 1;
    }
  }

  return stats;
}

async function cleanContactInboundDetailsField({ args, ghl, contact, field, exactScriptText }) {
  const contactId = contact.id;
  const customField = findContactCustomField(contact, field.id);
  const stats = {
    scanned: customField ? 1 : 0,
    matched: 0,
    updated: 0,
    skippedEmpty: 0,
  };

  if (!customField) {
    return stats;
  }

  const currentValue = getCustomFieldValue(customField);

  if (!containsSpeedToLeadRecommendedScript(currentValue, { exactScriptText })) {
    return stats;
  }

  const cleanedValue = cleanSpeedToLeadRecommendedScript(currentValue, { exactScriptText });
  const action = cleanedValue ? "update-custom-field" : "skip-empty-custom-field";
  stats.matched += 1;

  console.log(
    JSON.stringify(
      buildChangeLog({
        action,
        contactId,
        fieldId: field.id,
        fieldName: field.name || field.fieldKey || field.key || "",
        beforeValue: currentValue,
        afterValue: cleanedValue,
        dryRun: args.dryRun,
      })
    )
  );

  if (args.dryRun || action === "skip-empty-custom-field") {
    if (action === "skip-empty-custom-field") {
      stats.skippedEmpty += 1;
    }
    return stats;
  }

  await updateContactCustomField(ghl, contactId, field.id, cleanedValue);
  stats.updated += 1;

  return stats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tokenConfig = getGhlTokenConfig();
  const locationConfig = getGhlLocationConfig();
  const token = tokenConfig.value;
  const locationId = locationConfig.value;
  const configuredFieldId = process.env.GHL_INBOUND_LEAD_DETAILS_FIELD_ID;
  const exactScriptText = await readExactScriptText(args.exactScriptFile);

  if (!token) {
    throw new Error(`A GHL API token is required. Set one of: ${TOKEN_ENV_NAMES.join(", ")}.`);
  }

  if (!locationId && args.contactIds.length === 0) {
    throw new Error(
      `A GHL location ID is required to list contacts. Set one of: ${LOCATION_ENV_NAMES.join(", ")}, or configure CRM_WEBHOOK_URL so the location ID can be derived.`
    );
  }

  const ghl = createGhlClient(token);
  const inboundDetailsField = await resolveInboundLeadDetailsField(ghl, locationId, configuredFieldId);
  const contacts =
    args.contactIds.length > 0
      ? await Promise.all(args.contactIds.map((id) => getContact(ghl, id)))
      : await listContacts(ghl, locationId, args.limit);

  const totals = {
    notesScanned: 0,
    notesMatched: 0,
    notesUpdated: 0,
    notesDeleted: 0,
    notesSkippedEmpty: 0,
    customFieldsScanned: 0,
    customFieldsMatched: 0,
    customFieldsUpdated: 0,
    customFieldsSkippedEmpty: 0,
  };

  for (const contact of contacts) {
    const noteStats = await cleanContactNotes({ args, ghl, contact, exactScriptText });
    const fieldStats = await cleanContactInboundDetailsField({
      args,
      ghl,
      contact,
      field: inboundDetailsField,
      exactScriptText,
    });

    totals.notesScanned += noteStats.scanned;
    totals.notesMatched += noteStats.matched;
    totals.notesUpdated += noteStats.updated;
    totals.notesDeleted += noteStats.deleted;
    totals.notesSkippedEmpty += noteStats.skippedEmpty;
    totals.customFieldsScanned += fieldStats.scanned;
    totals.customFieldsMatched += fieldStats.matched;
    totals.customFieldsUpdated += fieldStats.updated;
    totals.customFieldsSkippedEmpty += fieldStats.skippedEmpty;
  }

  console.log(
    JSON.stringify({
      dryRun: args.dryRun,
      contactsScanned: contacts.length,
      tokenEnv: tokenConfig.name,
      locationEnv: locationConfig.name,
      inboundDetailsFieldId: inboundDetailsField.id,
      inboundDetailsFieldName: inboundDetailsField.name || inboundDetailsField.fieldKey || inboundDetailsField.key || "",
      ...totals,
    })
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  cleanSpeedToLeadRecommendedScript,
  cleanContactInboundDetailsField,
  deriveLocationIdFromWebhookUrl,
  getGhlLocationConfig,
  getGhlTokenConfig,
  getCustomFieldValue,
  isLikelyInboundLeadDetailsField,
  parseArgs,
  redactPreview,
  resolveInboundLeadDetailsField,
};
