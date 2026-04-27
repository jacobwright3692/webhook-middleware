require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`
    );
  });

  next();
});

function normalizeLeadPayload(rawPayload) {
  const normalized = {
    structured_data: {
      name: "",
      phone: "",
      email: "",
      property_address: "",
      asking_price: "",
      timeline: "",
      motivation: "",
      source: "",
      contact_source: "",
      city: "",
      state: "",
      postal_code: "",
    },
    unmapped_data: {},
    raw_webhook_payload: rawPayload,
    data_quality_score: 0,
  };

  const fieldMap = {
    name: "name",
    full_name: "name",
    fullname: "name",
    first_name: "first_name",
    firstname: "first_name",
    last_name: "last_name",
    lastname: "last_name",
    phone: "phone",
    phone_number: "phone",
    primary_phone: "phone",
    primaryphone: "phone",
    mobile: "phone",
    cell: "phone",
    contact_phone: "phone",
    email: "email",
    address: "property_address",
    property_address: "property_address",
    price: "asking_price",
    asking_price: "asking_price",
    offer_price: "asking_price",
    timeline: "timeline",
    timeframe: "timeline",
    sell_when: "timeline",
    motivation: "motivation",
    reason: "motivation",
    notes: "motivation",
    situation: "motivation",
    source: "contact_source",
    lead_source: "contact_source",
    provider: "contact_source",
    marketplace: "contact_source",
    contact_source: "contact_source",
    vendor: "contact_source",
    lead_vendor: "contact_source",
    leadprovider: "contact_source",
    lead_provider: "contact_source",
    company: "contact_source",
    campaign_source: "contact_source",
    city: "city",
    state: "state",
    postal: "postal_code",
    postal_code: "postal_code",
    zip: "postal_code",
    zip_code: "postal_code",
  };
  const nameParts = {
    first_name: "",
    last_name: "",
  };

  const normalizeKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, "");

  const propertyLeadsSignatureKeys = new Set([
    "leadid",
    "leadcost",
    "datecreated",
    "primaryphone",
    "firstname",
    "lastname",
  ]);

  const toSafeString = (value) => {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value.trim();
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }

    return "";
  };

  const normalizePhone = (value) => {
    const safeValue = toSafeString(value);

    if (!safeValue) {
      return "";
    }

    const digits = safeValue.replace(/\D/g, "");

    if (digits.length === 10) {
      return `+1${digits}`;
    }

    if (digits.length === 11 && digits.startsWith("1")) {
      return `+${digits}`;
    }

    return safeValue;
  };

  const normalizeContactSource = (value) => {
    const safeValue = toSafeString(value);
    const comparableValue = safeValue.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (["", "na", "none", "noanswer", "notanswered", "unknown"].includes(comparableValue)) {
      return "";
    }

    if (comparableValue === "propertyleads") {
      return "Property Leads";
    }

    if (comparableValue === "leadzolo") {
      return "Lead Zolo";
    }

    if (comparableValue === "speedtolead") {
      return "Speed to Lead";
    }

    return safeValue;
  };

  const toTitleCase = (value) =>
    toSafeString(value)
      .toLowerCase()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

  const isSpeedToLeadPayload = (value) => {
    if (value === null || value === undefined) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.some((item) => isSpeedToLeadPayload(item));
    }

    if (typeof value === "object") {
      return Object.entries(value).some(([key, entryValue]) => {
        const normalizedKey = normalizeKey(key);
        const sourceLikeKey = [
          "source",
          "leadsource",
          "provider",
          "marketplace",
          "contactsource",
          "vendor",
          "leadvendor",
          "leadprovider",
          "company",
          "campaignsource",
        ].includes(normalizedKey);

        if (sourceLikeKey && isSpeedToLeadPayload(entryValue)) {
          return true;
        }

        return entryValue !== null && typeof entryValue === "object"
          ? isSpeedToLeadPayload(entryValue)
          : false;
      });
    }

    return normalizeKey(value).includes("speedtolead");
  };

  const splitFullAddress = (address) => {
    const addressParts = toSafeString(address)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const street = addressParts.length >= 3 ? addressParts.slice(0, -2).join(", ") : "";
    const city = addressParts.length >= 3 ? addressParts[addressParts.length - 2] : "";
    const statePostal = addressParts.length >= 2 ? addressParts[addressParts.length - 1] : "";
    const statePostalMatch = statePostal.match(/^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);

    if (!street || !city || !statePostalMatch) {
      return null;
    }

    return {
      street,
      city,
      state: statePostalMatch[1].toUpperCase(),
      postal_code: statePostalMatch[2] || "",
    };
  };

  const findFirstValueByKeys = (value, keys) => {
    if (value === null || value === undefined) {
      return "";
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const foundValue = findFirstValueByKeys(item, keys);

        if (foundValue) {
          return foundValue;
        }
      }

      return "";
    }

    if (typeof value !== "object") {
      return "";
    }

    for (const [key, entryValue] of Object.entries(value)) {
      if (keys.has(normalizeKey(key))) {
        const safeValue = toSafeString(entryValue);

        if (safeValue) {
          return safeValue;
        }
      }

      const foundValue = findFirstValueByKeys(entryValue, keys);

      if (foundValue) {
        return foundValue;
      }
    }

    return "";
  };

  const preserveUnmappedValue = (key, value) => {
    if (!Object.prototype.hasOwnProperty.call(normalized.unmapped_data, key)) {
      normalized.unmapped_data[key] = value;
      return;
    }

    if (!Array.isArray(normalized.unmapped_data[key])) {
      normalized.unmapped_data[key] = [normalized.unmapped_data[key]];
    }

    normalized.unmapped_data[key].push(value);
  };

  const tryMapField = (key, value) => {
    const structuredField = fieldMap[String(key).toLowerCase()];
    const safeValue =
      structuredField === "phone"
        ? normalizePhone(value)
        : structuredField === "contact_source"
          ? normalizeContactSource(value)
          : toSafeString(value);

    if (!structuredField || !safeValue) {
      preserveUnmappedValue(key, value);
      return;
    }

    if (structuredField === "first_name" || structuredField === "last_name") {
      if (!nameParts[structuredField]) {
        nameParts[structuredField] = safeValue;
        return;
      }

      preserveUnmappedValue(key, value);
      return;
    }

    if (structuredField === "email" && !safeValue.includes("@")) {
      preserveUnmappedValue(key, value);
      return;
    }

    if (!normalized.structured_data[structuredField]) {
      normalized.structured_data[structuredField] = safeValue;

      if (structuredField === "contact_source" && !normalized.structured_data.source) {
        normalized.structured_data.source = safeValue;
      }

      return;
    }

    preserveUnmappedValue(key, value);
  };

  const walkPayload = (value) => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => walkPayload(item));
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    Object.entries(value).forEach(([key, entryValue]) => {
      if (
        entryValue !== null &&
        typeof entryValue === "object" &&
        !Array.isArray(entryValue)
      ) {
        preserveUnmappedValue(key, entryValue);
        walkPayload(entryValue);
        return;
      }

      if (Array.isArray(entryValue)) {
        preserveUnmappedValue(key, entryValue);
        walkPayload(entryValue);
        return;
      }

      tryMapField(key, entryValue);
    });
  };

  walkPayload(rawPayload);

  if (!normalized.structured_data.name && (nameParts.first_name || nameParts.last_name)) {
    normalized.structured_data.name = [nameParts.first_name, nameParts.last_name]
      .filter(Boolean)
      .join(" ");
  }

  const hasPropertyLeadsSignature = (value) => {
    if (value === null || value === undefined || typeof value !== "object") {
      return false;
    }

    if (Array.isArray(value)) {
      return value.some((item) => hasPropertyLeadsSignature(item));
    }

    return Object.entries(value).some(([key, entryValue]) => {
      if (propertyLeadsSignatureKeys.has(normalizeKey(key))) {
        return true;
      }

      return hasPropertyLeadsSignature(entryValue);
    });
  };

  if (!normalized.structured_data.contact_source && hasPropertyLeadsSignature(rawPayload)) {
    normalized.structured_data.contact_source = "Property Leads";
    normalized.structured_data.source = "Property Leads";
  }

  const isSpeedToLead = isSpeedToLeadPayload(rawPayload);

  if (isSpeedToLead) {
    normalized.structured_data.contact_source = "Speed to Lead";
    normalized.structured_data.source = "Speed to Lead";

    if (!normalized.structured_data.property_address) {
      normalized.structured_data.property_address = findFirstValueByKeys(
        rawPayload,
        new Set(["street", "streetaddress", "address1", "addressline1"])
      );
    }

    if (normalized.structured_data.city) {
      normalized.structured_data.city = toTitleCase(normalized.structured_data.city);
    }

    const parsedAddress = splitFullAddress(normalized.structured_data.property_address);

    if (parsedAddress) {
      normalized.structured_data.property_address = parsedAddress.street;

      if (!normalized.structured_data.city) {
        normalized.structured_data.city = toTitleCase(parsedAddress.city);
      }
      if (!normalized.structured_data.state) {
        normalized.structured_data.state = parsedAddress.state;
      }
      if (!normalized.structured_data.postal_code && parsedAddress.postal_code) {
        normalized.structured_data.postal_code = parsedAddress.postal_code;
      }
    }
  }

  if (
    normalized.structured_data.property_address &&
    (!normalized.structured_data.city ||
      !normalized.structured_data.state ||
      !normalized.structured_data.postal_code)
  ) {
    const addressParts = normalized.structured_data.property_address
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const cityCandidate = addressParts.length >= 3 ? addressParts[addressParts.length - 2] : "";
    const statePostalCandidate =
      addressParts.length >= 2 ? addressParts[addressParts.length - 1] : "";
    const statePostalMatch = statePostalCandidate.match(
      /^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/
    );

    if (cityCandidate && statePostalMatch) {
      if (!normalized.structured_data.city) {
        normalized.structured_data.city = cityCandidate;
      }
      if (!normalized.structured_data.state) {
        normalized.structured_data.state = statePostalMatch[1].toUpperCase();
      }
      if (!normalized.structured_data.postal_code && statePostalMatch[2]) {
        normalized.structured_data.postal_code = statePostalMatch[2];
      }
    } else if (addressParts.length > 1) {
      preserveUnmappedValue("address_parse_unclear", addressParts.slice(1));
    }
  }

  if (normalized.structured_data.phone) {
    normalized.data_quality_score += 20;
  }
  if (normalized.structured_data.name) {
    normalized.data_quality_score += 20;
  }
  if (normalized.structured_data.property_address) {
    normalized.data_quality_score += 20;
  }
  if (normalized.structured_data.motivation) {
    normalized.data_quality_score += 20;
  }
  if (normalized.structured_data.asking_price || normalized.structured_data.timeline) {
    normalized.data_quality_score += 20;
  }

  normalized.data_quality_score = Math.min(normalized.data_quality_score, 100);

  return normalized;
}

async function forwardToCRM(normalizedPayload) {
  const crmWebhookUrl = process.env.CRM_WEBHOOK_URL;

  if (!crmWebhookUrl) {
    throw new Error("CRM_WEBHOOK_URL environment variable is required");
  }

  const structuredData = normalizedPayload.structured_data || {};
  const directFieldAliases = new Set([
    "name",
    "full_name",
    "fullname",
    "first_name",
    "firstname",
    "last_name",
    "lastname",
    "phone",
    "phone_number",
    "primary_phone",
    "primaryphone",
    "mobile",
    "cell",
    "contact_phone",
    "email",
    "property_address",
    "address",
    "city",
    "state",
    "postal_code",
    "postal",
    "zip",
    "zip_code",
    "contact_source",
    "source",
    "lead_source",
    "provider",
    "marketplace",
    "vendor",
    "lead_vendor",
    "leadprovider",
    "lead_provider",
    "company",
    "campaign_source",
    "data_quality_score",
  ]);

  const formatNoteValue = (value) => {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  };

  const normalizeNoteValue = (value) =>
    formatNoteValue(value).trim().replace(/\s+/g, " ").toLowerCase();

  const isLowValueNote = (value) => {
    const normalizedValue = normalizeNoteValue(value);
    const compactValue = normalizedValue.replace(/[^a-z0-9]/g, "");
    const lowValueAnswers = new Set([
      "",
      "n/a",
      "na",
      "none",
      "no answer",
      "not answered",
      "unknown",
      "not applicable",
      "null",
      "undefined",
    ]);
    const compactLowValueAnswers = new Set([
      "na",
      "none",
      "noanswer",
      "notanswered",
      "unknown",
      "notapplicable",
      "null",
      "undefined",
    ]);

    return lowValueAnswers.has(normalizedValue) || compactLowValueAnswers.has(compactValue);
  };

  const noteDetails = new Map();

  ["asking_price", "timeline", "motivation"].forEach((key) => {
    if (structuredData[key]) {
      noteDetails.set(key, structuredData[key]);
    }
  });

  Object.entries(normalizedPayload.unmapped_data || {}).forEach(([key, value]) => {
    noteDetails.set(key, value);
  });

  const collectRawNoteDetails = (value) => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectRawNoteDetails(item));
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    Object.entries(value).forEach(([key, entryValue]) => {
      const normalizedKey = String(key).toLowerCase();

      if (!directFieldAliases.has(normalizedKey)) {
        noteDetails.set(key, entryValue);
      }

      if (entryValue !== null && typeof entryValue === "object") {
        collectRawNoteDetails(entryValue);
      }
    });
  };

  collectRawNoteDetails(normalizedPayload.raw_webhook_payload);

  const notesLines = ["Inbound Lead Details:"];
  const isSpeedToLeadNormalized = structuredData.contact_source === "Speed to Lead";
  const speedToLeadAddressKeys = new Set([
    "address",
    "propertyaddress",
    "property_address",
    "street",
    "streetaddress",
    "street_address",
    "city",
    "state",
    "postal",
    "postalcode",
    "postal_code",
    "zip",
    "zipcode",
    "zip_code",
  ]);
  const speedToLeadAddressValues = new Set(
    [
      structuredData.property_address,
      structuredData.city,
      structuredData.state,
      structuredData.postal_code,
    ]
      .map((value) => normalizeNoteValue(value))
      .filter(Boolean)
  );

  noteDetails.forEach((value, key) => {
    if (isLowValueNote(value)) {
      return;
    }

    if (
      isSpeedToLeadNormalized &&
      (speedToLeadAddressKeys.has(String(key).toLowerCase().replace(/[^a-z0-9]/g, "")) ||
        speedToLeadAddressValues.has(normalizeNoteValue(value)))
    ) {
      return;
    }

    notesLines.push(`- ${key}: ${formatNoteValue(value)}`);
  });

  const formatOutboundPhone = (phone) => {
    const digits = String(phone || "").replace(/\D/g, "");
    const tenDigitPhone =
      digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

    if (tenDigitPhone.length === 10) {
      return `(${tenDigitPhone.slice(0, 3)}) ${tenDigitPhone.slice(
        3,
        6
      )}-${tenDigitPhone.slice(6)}`;
    }

    return phone || "";
  };

  const crmPayload = {
    name: structuredData.name || "",
    phone: formatOutboundPhone(structuredData.phone),
    email: structuredData.email || "",
    property_address: structuredData.property_address || "",
    city: structuredData.city || "",
    state: structuredData.state || "",
    postal_code: structuredData.postal_code || "",
    contact_source: structuredData.contact_source || "",
    data_quality_score: normalizedPayload.data_quality_score || 0,
    notes: notesLines.join("\n"),
  };

  console.log("Final outbound CRM payload:", JSON.stringify(crmPayload, null, 2));

  const fetchOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(crmPayload),
  };

  if (AbortSignal.timeout) {
    fetchOptions.signal = AbortSignal.timeout(10000);
  }

  let response;
  let responseBody;

  try {
    response = await fetch(crmWebhookUrl, fetchOptions);
    responseBody = await response.text();
  } catch (error) {
    console.error(`CRM forward request failed: ${error.message}`);

    return {
      success: false,
      statusCode: null,
      responseBody: "",
      error: error.message,
    };
  }

  if (!response.ok) {
    console.error(`CRM forward failed with status ${response.status}`);
    console.error(`CRM response body: ${responseBody}`);

    return {
      success: false,
      statusCode: response.status,
      responseBody,
      error: `CRM webhook returned status ${response.status}`,
    };
  }

  return {
    success: true,
    statusCode: response.status,
    responseBody,
  };
}

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "webhook-middleware-agent",
  });
});

app.post("/webhook/lead", async (req, res, next) => {
  try {
    const hasBody = req.body && Object.keys(req.body).length > 0;
    const hasQuery = req.query && Object.keys(req.query).length > 0;
    const inboundPayload = hasBody ? req.body : hasQuery ? req.query : {};

    console.log("RAW BODY:", JSON.stringify(req.body, null, 2));
    console.log("RAW QUERY:", JSON.stringify(req.query, null, 2));
    console.log("INBOUND PAYLOAD USED:", JSON.stringify(inboundPayload, null, 2));

    const normalizedPayload = normalizeLeadPayload(inboundPayload);

    if (!process.env.CRM_WEBHOOK_URL) {
      console.log("CRM_WEBHOOK_URL missing — skipping CRM forward in local test mode");

      return res.status(202).json({
        status: "accepted",
        mode: "local_test_no_crm_forward",
        normalized: normalizedPayload,
      });
    }

    const crmResult = await forwardToCRM(normalizedPayload);

    if (!crmResult.success) {
      return res.status(502).json({
        status: "crm_forward_failed",
        error: crmResult,
        normalized: normalizedPayload,
      });
    }

    res.status(202).json({
      status: "accepted",
      mode: "crm_forwarded",
      crm_status: crmResult.statusCode,
      normalized: normalizedPayload,
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `No route for ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      error: "Invalid JSON",
      message: "Request body must be valid JSON.",
    });
  }

  console.error(error);

  return res.status(500).json({
    error: "Internal Server Error",
    message: error.message || "An unexpected error occurred.",
  });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Webhook middleware agent listening on port ${PORT}`);
  });

  server.on("error", (error) => {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  app,
  normalizeLeadPayload,
  forwardToCRM,
};
