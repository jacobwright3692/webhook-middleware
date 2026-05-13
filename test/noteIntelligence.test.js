const assert = require("assert");
const test = require("node:test");

const { buildAcquisitionsCrmNote } = require("../src/noteIntelligence");
const { buildOutboundCrmPayload, normalizeLeadPayload } = require("../src/server");
const { remediateRecords } = require("../scripts/remediate-crm-notes");

test("formats Speed to Lead notes as acquisitions intelligence without script or noisy payload", () => {
  const payload = normalizeLeadPayload({
    source: "SpeedToLead",
    full_name: "Casey Seller",
    phone: "555-555-1212",
    property_address: "123 Main St, Dallas, TX 75201, USA",
    asking_price: "$145,000",
    timeline: "ASAP",
    motivation: "Inherited property and wants a quick cash sale",
    condition: "Roof is older and kitchen needs repairs",
    occupancy: "Vacant",
    trusted_form_cert_url: "https://cert.trustedform.com/abc",
    lead_cost: "75",
    recommended_script: "Recommended Script:\nSay this sales pitch.",
    comments: "Seller asked for a callback this evening after work.",
  });

  const note = buildOutboundCrmPayload(payload).notes;

  assert.match(note, /^Quick Read/);
  assert.match(note, /Seller Summary/);
  assert.match(note, /Property Summary/);
  assert.match(note, /Motivation \/ Timeline/);
  assert.match(note, /Property Condition/);
  assert.match(note, /Important Flags/);
  assert.match(note, /Follow-up Guidance/);
  assert.match(note, /Casey Seller/);
  assert.match(note, /123 Main St, Dallas, TX 75201/);
  assert.match(note, /Inherited property/);
  assert.match(note, /Roof is older/);
  assert.match(note, /Vacancy signal/);
  assert.match(note, /Prioritize same-day callback/);
  assert.doesNotMatch(note, /Recommended Script/i);
  assert.doesNotMatch(note, /trusted_form/i);
  assert.doesNotMatch(note, /lead_cost/i);
});

test("normalizes Lead Zolo notes into the same section structure", () => {
  const payload = normalizeLeadPayload({
    provider: "LeadZolo",
    name: "Jordan Owner",
    phone_number: "(555) 010-2222",
    address: "44 Oak Ave, Tampa, FL 33602",
    price: "Needs $210k",
    timeframe: "30 days",
    reason: "Tired landlord with tenant issues",
    repair_notes: "HVAC is old",
    tenant_status: "Tenant occupied",
    best_time_to_call: "Text first, call in the morning",
    utm_campaign: "internal-campaign",
  });

  const note = buildOutboundCrmPayload(payload).notes;

  assert.match(note, /^Quick Read/);
  assert.match(note, /Seller Summary/);
  assert.match(note, /Property Condition/);
  assert.match(note, /Occupancy/);
  assert.match(note, /Contact Preferences/);
  assert.match(note, /Lead source: Lead Zolo/);
  assert.match(note, /Tenant\/rental signal/);
  assert.doesNotMatch(note, /utm_campaign/i);
});

test("normalizes Proper Leads source naming and preserves important financial signals", () => {
  const payload = normalizeLeadPayload({
    lead_source: "ProperLeads",
    first_name: "Morgan",
    last_name: "Smith",
    primary_phone: "5550103333",
    property_address: "9 Pine Rd, Columbus, OH 43215",
    mortgage_balance: "$98,000",
    notes: "Behind on payments and wants to avoid foreclosure.",
    lowest_price: "$120,000",
    lead_id: "proper-123",
  });

  const note = buildOutboundCrmPayload(payload).notes;

  assert.match(note, /Lead source: Proper Leads/);
  assert.match(note, /Mortgage \/ Financial/);
  assert.match(note, /Mortgage: \$98,000/);
  assert.match(note, /Financial distress signal/);
  assert.match(note, /Foreclosure\/default signal/);
  assert.doesNotMatch(note, /lead_id/i);
});

test("omits empty and low-value fields without hallucinating seller details", () => {
  const note = buildAcquisitionsCrmNote({
    structured_data: {
      contact_source: "Unknown Provider",
      property_address: "77 Maple St",
    },
    unmapped_data: {
      motivation: "N/A",
      condition: "unknown",
      callback: "",
      session_id: "abc123",
    },
    raw_webhook_payload: {},
  });

  assert.match(note, /^Quick Read/);
  assert.match(note, /77 Maple St/);
  assert.doesNotMatch(note, /Lead source: Unknown Provider/);
  assert.doesNotMatch(note, /N\/A/i);
  assert.doesNotMatch(note, /unknown/i);
  assert.doesNotMatch(note, /session/i);
  assert.doesNotMatch(note, /Seller name not provided/i);
});

test("extracts important signals from noisy provider notes", () => {
  const note = buildAcquisitionsCrmNote({
    structured_data: {
      name: "Avery Seller",
      contact_source: "Speed to Lead",
      property_address: "15 Birch Ln",
    },
    unmapped_data: {
      raw_notes:
        "Vacant inherited house. Needs repairs. Seller says call back after 6. Spanish preferred.",
      click_id: "click-123",
      webhook_event: "lead.created",
    },
    raw_webhook_payload: {},
  });

  assert.match(note, /Vacancy signal/);
  assert.match(note, /Probate\/inherited property/);
  assert.match(note, /Condition\/repair signal/);
  assert.match(note, /Contact preference signal/);
  assert.match(note, /Language\/access signal/);
  assert.doesNotMatch(note, /click_id/i);
  assert.doesNotMatch(note, /webhook_event/i);
});

test("historical remediation preview preserves original notes and generates standardized notes", () => {
  const preview = remediateRecords([
    {
      contactId: "contact_123",
      noteId: "note_123",
      originalNote: "Raw dump: Seller says vacant inherited house, call tonight.",
      rawPayload: {
        source: "SpeedToLead",
        name: "Riley Seller",
        phone: "555-010-4444",
        property_address: "22 Cedar St, Dayton, OH 45402",
        notes: "Vacant inherited house, call tonight.",
      },
    },
  ]);

  assert.equal(preview.length, 1);
  assert.equal(preview[0].contactId, "contact_123");
  assert.equal(preview[0].noteId, "note_123");
  assert.match(preview[0].originalNote, /Raw dump/);
  assert.match(preview[0].standardizedNote, /^Quick Read/);
  assert.match(preview[0].standardizedNote, /Important Flags/);
  assert.equal(preview[0].preservationMode, "preview_only_no_crm_write");
});
