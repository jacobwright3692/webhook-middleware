const assert = require("assert");
const test = require("node:test");

const { buildAcquisitionsCrmNote } = require("../src/noteIntelligence");
const { buildOutboundCrmPayload, normalizeLeadPayload } = require("../src/server");
const { remediateRecords } = require("../scripts/remediate-crm-notes");

test("routes Speed to Lead structured fields and keeps notes to unique seller context", () => {
  const payload = normalizeLeadPayload({
    source: "SpeedToLead",
    full_name: "casey seller",
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

  const crmPayload = buildOutboundCrmPayload(payload);

  assert.equal(crmPayload.name, "Casey Seller");
  assert.equal(crmPayload.property_address, "123 Main St");
  assert.equal(crmPayload.city, "Dallas");
  assert.equal(crmPayload.state, "TX");
  assert.equal(crmPayload.postal_code, "75201");
  assert.equal(crmPayload.occupancy, "Vacant");
  assert.equal(crmPayload.timeline_to_sell, "ASAP");
  assert.equal(crmPayload.motivation_level, "Inherited property and wants a quick cash sale");
  assert.match(crmPayload.notes, /^Seller Context/);
  assert.match(crmPayload.notes, /callback this evening/);
  assert.doesNotMatch(crmPayload.notes, /Casey Seller/);
  assert.doesNotMatch(crmPayload.notes, /123 Main/i);
  assert.doesNotMatch(crmPayload.notes, /Dallas|TX|75201/);
  assert.doesNotMatch(crmPayload.notes, /Inherited property/);
  assert.doesNotMatch(crmPayload.notes, /Roof is older/);
  assert.doesNotMatch(crmPayload.notes, /Vacant/);
  assert.doesNotMatch(crmPayload.notes, /Recommended Script/i);
  assert.doesNotMatch(crmPayload.notes, /trusted_form/i);
  assert.doesNotMatch(crmPayload.notes, /lead_cost/i);
});

test("normalizes Lead Zolo structured fields without duplicating notes", () => {
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

  const crmPayload = buildOutboundCrmPayload(payload);

  assert.equal(crmPayload.property_address, "44 Oak Ave");
  assert.equal(crmPayload.city, "Tampa");
  assert.equal(crmPayload.state, "FL");
  assert.equal(crmPayload.postal_code, "33602");
  assert.equal(crmPayload.occupancy, "Tenant Occupied");
  assert.equal(crmPayload.timeline_to_sell, "30 days");
  assert.equal(crmPayload.motivation_level, "Tired landlord with tenant issues");
  assert.equal(crmPayload.notes, "");
});

test("normalizes Proper Leads source naming and keeps financial motivation out of notes", () => {
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

  const crmPayload = buildOutboundCrmPayload(payload);

  assert.equal(crmPayload.contact_source, "Proper Leads");
  assert.equal(crmPayload.property_address, "9 Pine Rd");
  assert.equal(crmPayload.city, "Columbus");
  assert.equal(crmPayload.state, "OH");
  assert.equal(crmPayload.postal_code, "43215");
  assert.equal(crmPayload.motivation_level, "Behind on payments and wants to avoid foreclosure.");
  assert.equal(crmPayload.notes, "");
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
  assert.equal(preview[0].standardizedNote, "");
  assert.equal(preview[0].preservationMode, "preview_only_no_crm_write");
});

test("leaves notes empty when payload only contains duplicated seller and property fields", () => {
  const payload = normalizeLeadPayload({
    name: "SAM SELLER",
    phone: "555-111-2222",
    email: "sam@example.com",
    property_address: "318 Bowman Street, Mansfield, OH 44903",
    bedrooms: "3",
    bathrooms: "1",
    lot_size: "0.12 acres",
    county: "Richland",
    price: "$100,000",
    condition: "Good",
    timeline: "Urgent",
    vacant: "yes",
    reason: "Financial emergency",
  });
  const crmPayload = buildOutboundCrmPayload(payload);

  assert.equal(crmPayload.name, "Sam Seller");
  assert.equal(crmPayload.property_address, "318 Bowman Street");
  assert.equal(crmPayload.city, "Mansfield");
  assert.equal(crmPayload.state, "OH");
  assert.equal(crmPayload.postal_code, "44903");
  assert.equal(crmPayload.occupancy, "Vacant");
  assert.equal(crmPayload.timeline_to_sell, "Urgent");
  assert.equal(crmPayload.motivation_level, "Financial emergency");
  assert.equal(crmPayload.notes, "");
});

test("parses street city state zip without commas and supports configured motivation field", () => {
  const previousMotivationFieldKey = process.env.CRM_MOTIVATION_FIELD_KEY;
  process.env.CRM_MOTIVATION_FIELD_KEY = "motivation_reason";

  try {
    const payload = normalizeLeadPayload({
      full_name: "taylor owner",
      address: "500 West Broad Street Mansfield Ohio 44903",
      occupancy: "Owner occupied",
      timeline_to_sell: "Within 14 days",
      emergency: "Medical bills",
    });
    const crmPayload = buildOutboundCrmPayload(payload);

    assert.equal(crmPayload.name, "Taylor Owner");
    assert.equal(crmPayload.property_address, "500 West Broad Street");
    assert.equal(crmPayload.city, "Mansfield");
    assert.equal(crmPayload.state, "OH");
    assert.equal(crmPayload.postal_code, "44903");
    assert.equal(crmPayload.occupancy, "Occupied");
    assert.equal(crmPayload.timeline_to_sell, "Within 14 days");
    assert.equal(crmPayload.motivation_level, "Medical bills");
    assert.equal(crmPayload.motivation_reason, "Medical bills");
    assert.equal(crmPayload.notes, "");
  } finally {
    if (previousMotivationFieldKey === undefined) {
      delete process.env.CRM_MOTIVATION_FIELD_KEY;
    } else {
      process.env.CRM_MOTIVATION_FIELD_KEY = previousMotivationFieldKey;
    }
  }
});
