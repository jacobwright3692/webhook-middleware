require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL;

app.use(express.json());

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
    },
    unmapped_data: {},
    raw_webhook_payload: rawPayload,
    data_quality_score: 0,
  };

  const fieldMap = {
    name: "name",
    full_name: "name",
    phone: "phone",
    phone_number: "phone",
    mobile: "phone",
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
    source: "source",
    lead_source: "source",
    provider: "source",
  };

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
    const safeValue = toSafeString(value);

    if (!structuredField || !safeValue) {
      preserveUnmappedValue(key, value);
      return;
    }

    if (structuredField === "email" && !safeValue.includes("@")) {
      preserveUnmappedValue(key, value);
      return;
    }

    if (!normalized.structured_data[structuredField]) {
      normalized.structured_data[structuredField] = safeValue;
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
  const crmPayload = {
    structured_data: normalizedPayload.structured_data || {
      name: "",
      phone: "",
      email: "",
      property_address: "",
      asking_price: "",
      timeline: "",
      motivation: "",
      source: "",
    },
    unmapped_data: normalizedPayload.unmapped_data || {},
    raw_webhook_payload: normalizedPayload.raw_webhook_payload || {},
    name: structuredData.name || "",
    phone: structuredData.phone || "",
    email: structuredData.email || "",
    property_address: structuredData.property_address || "",
    asking_price: structuredData.asking_price || "",
    timeline: structuredData.timeline || "",
    motivation: structuredData.motivation || "",
    source: structuredData.source || "",
    data_quality_score: normalizedPayload.data_quality_score || 0,
  };

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
    const normalizedPayload = normalizeLeadPayload(req.body);

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
