const assert = require("assert");
const test = require("node:test");

const { cleanSpeedToLeadRecommendedScript } = require("../src/noteCleaning");
const {
  cleanContactInboundDetailsField,
  deriveLocationIdFromWebhookUrl,
  getGhlLocationConfig,
  getGhlTokenConfig,
  isLikelyInboundLeadDetailsField,
} = require("../scripts/cleanup-speed-to-lead-notes");

test("removes a Speed to Lead recommended script block", () => {
  const note = [
    "Seller says they want to sell this month.",
    "Recommended Script:",
    "Hi, this is Alex calling about your property.",
    "Ask if they still want an offer and confirm motivation.",
  ].join("\n");

  assert.strictEqual(
    cleanSpeedToLeadRecommendedScript(note),
    "Seller says they want to sell this month."
  );
});

test("leaves a note unchanged when no recommended script is present", () => {
  const note = "Seller wants a cash offer.\n\nTimeline: 30 days.";

  assert.strictEqual(cleanSpeedToLeadRecommendedScript(note), note);
});

test("keeps useful content before and after the recommended script", () => {
  const note = [
    "Seller Notes: Owner wants to sell after probate clears.",
    "Recommended Call Script:",
    "Hi, this is Alex. I saw you requested a cash offer.",
    "Ask about repairs and timeline.",
    "Property Notes: Roof is older, kitchen needs updates.",
  ].join("\n");

  assert.strictEqual(
    cleanSpeedToLeadRecommendedScript(note),
    [
      "Seller Notes: Owner wants to sell after probate clears.",
      "Property Notes: Roof is older, kitchen needs updates.",
    ].join("\n")
  );
});

test("removes an exact configured script without removing surrounding text", () => {
  const exactScriptText = "Say this exact recommended script to the seller.";
  const note = `Before useful text.\n${exactScriptText}\nAfter useful text.`;

  assert.strictEqual(
    cleanSpeedToLeadRecommendedScript(note, { exactScriptText }),
    "Before useful text.\nAfter useful text."
  );
});

test("cleans a custom field value with useful lead details before the call strategy", () => {
  const value = [
    "Inbound Lead Details:",
    "- summary: Seller wants to sell soon.",
    "- repairs: Roof and flooring need work.",
    "- call_strategy: Set the Frame and Confirm Intent",
    "\"Hi [Seller], this is Sam with [Company Name].\"",
    "Lock Their Number First",
  ].join("\n");

  assert.strictEqual(
    cleanSpeedToLeadRecommendedScript(value),
    [
      "Inbound Lead Details:",
      "- summary: Seller wants to sell soon.",
      "- repairs: Roof and flooring need work.",
    ].join("\n")
  );
});

test("cleans a custom field value and keeps useful lead details after the call strategy", () => {
  const value = [
    "Inbound Lead Details:",
    "- summary: Seller is tenant fatigued.",
    "- call_strategy: Quick Authority Check",
    "\"Are you still looking to sell [Property]?\"",
    "Live DocuSign Close",
    "- county_name: Dallas",
    "- price: 2",
  ].join("\n");

  assert.strictEqual(
    cleanSpeedToLeadRecommendedScript(value),
    [
      "Inbound Lead Details:",
      "- summary: Seller is tenant fatigued.",
      "- county_name: Dallas",
      "- price: 2",
    ].join("\n")
  );
});

test("leaves a custom field value unchanged when it has no script", () => {
  const value = [
    "Inbound Lead Details:",
    "- summary: Seller wants a cash offer.",
    "- county_name: Harris",
    "- price: 2",
  ].join("\n");

  assert.strictEqual(cleanSpeedToLeadRecommendedScript(value), value);
});

test("cleans a custom field value that is only the script", () => {
  const value = [
    "- call_strategy: Confirm Intent",
    "\"Hi [Seller], this is [Your Name].\"",
    "Ask for the lowest acceptable price.",
  ].join("\n");

  assert.strictEqual(cleanSpeedToLeadRecommendedScript(value), "");
});

test("identifies likely inbound lead details custom fields", () => {
  assert.strictEqual(isLikelyInboundLeadDetailsField({ name: "Inbound Lead Details" }), true);
  assert.strictEqual(isLikelyInboundLeadDetailsField({ fieldKey: "contact.inbound_lead_details" }), true);
  assert.strictEqual(isLikelyInboundLeadDetailsField({ name: "Preferred Call Time" }), false);
});

test("dry-run custom field cleanup logs a redacted update without writing", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(JSON.parse(message));

  try {
    const stats = await cleanContactInboundDetailsField({
      args: { dryRun: true },
      ghl: {
        request: async () => {
          throw new Error("dry-run should not write");
        },
      },
      contact: {
        id: "contact_123",
        customFields: [
          {
            id: "field_123",
            value: [
              "Inbound Lead Details:",
              "- summary: Seller at 123 Main St wants a cash offer.",
              "- call_strategy: Confirm Intent",
              "\"Hi John Seller, call me at 555-555-1212.\"",
              "- county_name: Dallas",
            ].join("\n"),
          },
        ],
      },
      field: { id: "field_123", name: "Inbound Lead Details" },
      exactScriptText: "",
    });

    assert.deepStrictEqual(stats, {
      scanned: 1,
      matched: 1,
      updated: 0,
      skippedEmpty: 0,
    });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].action, "dry-run:update-custom-field");
    assert.match(logs[0].beforePreview, /\[address\]/);
    assert.match(logs[0].beforePreview, /\[phone\]/);
    assert.doesNotMatch(logs[0].afterPreview, /call_strategy/);
  } finally {
    console.log = originalLog;
  }
});

test("resolves GHL token env aliases in safe priority order", () => {
  const tokenConfig = getGhlTokenConfig({
    GHL_ACCESS_TOKEN: "access-token",
    GHL_PRIVATE_INTEGRATION_TOKEN: "private-token",
    GHL_API_TOKEN: "api-token",
  });

  assert.strictEqual(tokenConfig.name, "GHL_API_TOKEN");
  assert.strictEqual(tokenConfig.value, "api-token");
});

test("derives location ID from the existing CRM webhook URL", () => {
  assert.strictEqual(
    deriveLocationIdFromWebhookUrl(
      "https://services.leadconnectorhq.com/hooks/FgDUgxnFPPYOmYRjlzGn/webhook-trigger/example"
    ),
    "FgDUgxnFPPYOmYRjlzGn"
  );
});

test("uses explicit location env before deriving from CRM webhook URL", () => {
  const locationConfig = getGhlLocationConfig({
    GHL_LOCATION_ID: "explicit-location",
    CRM_WEBHOOK_URL:
      "https://services.leadconnectorhq.com/hooks/derived-location/webhook-trigger/example",
  });

  assert.strictEqual(locationConfig.name, "GHL_LOCATION_ID");
  assert.strictEqual(locationConfig.value, "explicit-location");
});

test("falls back to CRM_WEBHOOK_URL for location ID", () => {
  const locationConfig = getGhlLocationConfig({
    CRM_WEBHOOK_URL:
      "https://services.leadconnectorhq.com/hooks/derived-location/webhook-trigger/example",
  });

  assert.strictEqual(locationConfig.name, "CRM_WEBHOOK_URL");
  assert.strictEqual(locationConfig.value, "derived-location");
});
