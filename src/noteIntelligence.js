const { cleanSpeedToLeadRecommendedScript } = require("./noteCleaning");

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

const noisyKeyFragments = [
  "affiliate",
  "api",
  "browser",
  "campaignid",
  "clickid",
  "createdat",
  "datecreated",
  "debug",
  "fbclid",
  "formid",
  "gclid",
  "ipaddress",
  "jornaya",
  "leadcost",
  "leadid",
  "metadata",
  "requestid",
  "session",
  "sourceurl",
  "token",
  "tracking",
  "trustedform",
  "updatedat",
  "utm",
  "webhook",
  "zapier",
];

const directFieldKeys = new Set([
  "address",
  "askingprice",
  "campaignsource",
  "city",
  "company",
  "contactphone",
  "contactsource",
  "email",
  "firstname",
  "fullname",
  "lastname",
  "leadprovider",
  "leadsource",
  "leadvendor",
  "marketplace",
  "mobile",
  "name",
  "phone",
  "phonenumber",
  "postal",
  "postalcode",
  "primaryphone",
  "propertyaddress",
  "provider",
  "source",
  "state",
  "vendor",
  "zip",
  "zipcode",
]);

const sectionKeyMatchers = [
  {
    section: "motivation",
    patterns: [
      "motivation",
      "reason",
      "situation",
      "why",
      "distress",
      "urgent",
      "probate",
      "foreclosure",
      "divorce",
      "tiredlandlord",
    ],
  },
  {
    section: "timeline",
    patterns: ["timeline", "timeframe", "sellwhen", "closewhen", "moving", "deadline"],
  },
  {
    section: "condition",
    patterns: ["condition", "repair", "repairs", "roof", "hvac", "kitchen", "bath", "foundation", "damage"],
  },
  {
    section: "price",
    patterns: ["price", "asking", "ask", "lowest", "mortgagebalance", "balance", "payoff", "owed"],
  },
  {
    section: "occupancy",
    patterns: ["occupancy", "occupied", "vacant", "tenant", "rented", "rental", "owneroccupied"],
  },
  {
    section: "financial",
    patterns: ["mortgage", "tax", "liens", "arrears", "behind", "payment", "cashflow", "rent"],
  },
  {
    section: "contact",
    patterns: ["callback", "calltime", "contactpreference", "preferred", "language", "spanish", "emailok"],
  },
  {
    section: "property",
    patterns: ["bed", "bath", "sqft", "squarefeet", "lot", "yearbuilt", "propertytype", "county"],
  },
];

const importantValueSignals = [
  { pattern: /\b(urgent|asap|immediately|today|now|quick|fast)\b/i, label: "Urgent timeline" },
  { pattern: /\b(foreclosure|pre-foreclosure|auction|default)\b/i, label: "Foreclosure/default signal" },
  { pattern: /\b(probate|inherited|estate)\b/i, label: "Probate/inherited property" },
  { pattern: /\b(divorce|separation)\b/i, label: "Divorce/separation signal" },
  { pattern: /\b(vacant|empty|abandoned)\b/i, label: "Vacancy signal" },
  { pattern: /\b(tenant|renter|rented|rental)\b/i, label: "Tenant/rental signal" },
  { pattern: /\b(repairs?|damage|needs work|fixer|tear ?down)\b/i, label: "Condition/repair signal" },
  { pattern: /\b(callback|call back|text me|do not call|after \d|morning|evening)\b/i, label: "Contact preference signal" },
  { pattern: /\b(spanish|interpreter|language barrier)\b/i, label: "Language/access signal" },
  { pattern: /\b(behind|arrears|past due|tax lien|lien|owed|payoff)\b/i, label: "Financial distress signal" },
];

function normalizeKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function labelizeKey(key) {
  return String(key || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function cleanValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return "";
    }
  }
  return String(value).trim().replace(/\s+/g, " ");
}

function isLowValue(value) {
  const normalized = cleanValue(value).toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return lowValueAnswers.has(normalized) || lowValueAnswers.has(compact);
}

function isNoisyKey(key) {
  const normalized = normalizeKey(key);
  if (directFieldKeys.has(normalized)) return true;
  return noisyKeyFragments.some((fragment) => normalized.includes(fragment));
}

function addUnique(bucket, value) {
  const text = cleanValue(value);
  if (!text || isLowValue(text)) return;
  if (!bucket.some((item) => item.toLowerCase() === text.toLowerCase())) {
    bucket.push(text);
  }
}

function addLabeledUnique(bucket, key, value) {
  const text = cleanValue(value);
  if (!text || isLowValue(text)) return;
  const line = `${labelizeKey(key)}: ${text}`;
  addUnique(bucket, line);
}

function collectEntries(value, prefix = "", entries = []) {
  if (value === null || value === undefined) return entries;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectEntries(item, `${prefix}${prefix ? "." : ""}${index}`, entries));
    return entries;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, entryValue]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (entryValue !== null && typeof entryValue === "object") {
        collectEntries(entryValue, nextPrefix, entries);
        return;
      }
      entries.push({ key, path: nextPrefix, value: entryValue });
    });
    return entries;
  }
  entries.push({ key: prefix, path: prefix, value });
  return entries;
}

function resolveSection(key, value) {
  const normalizedKey = normalizeKey(key);
  const normalizedValue = cleanValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const matcher of sectionKeyMatchers) {
    if (matcher.patterns.some((pattern) => normalizedKey.includes(pattern) || normalizedValue.includes(pattern))) {
      return matcher.section;
    }
  }
  return "";
}

function formatList(title, items) {
  if (!items.length) return [];
  return [title, ...items.map((item) => `- ${item}`)];
}

function buildPropertyLine(structuredData = {}) {
  const street = cleanValue(structuredData.property_address || structuredData.address);
  const city = cleanValue(structuredData.city);
  const state = cleanValue(structuredData.state);
  const postal = cleanValue(structuredData.postal_code || structuredData.zip || structuredData.zip_code);
  const compactStreet = street.toLowerCase();
  if (street && city && state && compactStreet.includes(city.toLowerCase()) && compactStreet.includes(state.toLowerCase())) {
    return street;
  }
  const cityState = [city, [state, postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, cityState].filter(Boolean).join(", ");
}

function buildQuickRead({ structuredData, buckets, flags }) {
  const lines = ["Quick Read"];
  const seller = cleanValue(structuredData.name);
  const property = buildPropertyLine(structuredData);
  const motivation = cleanValue(structuredData.motivation) || buckets.motivation[0] || "";
  const timeline = cleanValue(structuredData.timeline) || buckets.timeline[0] || "";
  const price = cleanValue(structuredData.asking_price) || buckets.price[0] || "";

  if (seller) lines.push(`- Seller: ${seller}`);
  if (property) lines.push(`- Property: ${property}`);
  if (motivation || timeline) {
    lines.push(`- Motivation/Timeline: ${[motivation, timeline].filter(Boolean).join(" / ")}`);
  }
  if (price) lines.push(`- Price: ${price}`);
  if (flags.length) lines.push(`- Flags: ${flags.slice(0, 3).join("; ")}`);
  if (lines.length === 1) lines.push("- Source lead received; confirm seller and property details on first contact.");

  return lines;
}

function buildAcquisitionsCrmNote(normalizedPayload = {}) {
  const structuredData = normalizedPayload.structured_data || {};
  const source = cleanValue(structuredData.contact_source || structuredData.source || normalizedPayload.source);
  const isSpeedToLead = source.toLowerCase() === "speed to lead";
  const buckets = {
    seller: [],
    property: [],
    motivation: [],
    timeline: [],
    condition: [],
    price: [],
    occupancy: [],
    financial: [],
    contact: [],
    source: [],
    flags: [],
    followUp: [],
  };
  const seenValues = new Set();
  const addFlagsFromText = (value) => {
    const text = cleanValue(value);
    if (!text) return;
    importantValueSignals.forEach(({ pattern, label }) => {
      if (pattern.test(text)) addUnique(buckets.flags, label);
    });
  };

  [
    structuredData.name,
    structuredData.phone,
    structuredData.email,
    structuredData.property_address,
    structuredData.city,
    structuredData.state,
    structuredData.postal_code,
    structuredData.motivation,
    structuredData.timeline,
    structuredData.condition,
    structuredData.occupancy,
    structuredData.mortgage,
    structuredData.contact_preferences,
    structuredData.asking_price,
    structuredData.contact_source,
  ].forEach((value) => {
    addFlagsFromText(value);
    const text = cleanValue(value).toLowerCase();
    if (text) seenValues.add(text);
  });

  addUnique(buckets.seller, cleanValue(structuredData.name) ? `Name: ${structuredData.name}` : "");
  addUnique(buckets.seller, cleanValue(structuredData.phone) ? `Phone: ${structuredData.phone}` : "");
  addUnique(buckets.seller, cleanValue(structuredData.email) ? `Email: ${structuredData.email}` : "");
  addUnique(buckets.property, buildPropertyLine(structuredData) ? `Address: ${buildPropertyLine(structuredData)}` : "");
  addUnique(buckets.motivation, structuredData.motivation);
  addUnique(buckets.timeline, structuredData.timeline);
  addUnique(buckets.condition, structuredData.condition);
  addUnique(buckets.occupancy, structuredData.occupancy);
  addUnique(buckets.financial, structuredData.mortgage ? `Mortgage: ${structuredData.mortgage}` : "");
  addUnique(buckets.contact, structuredData.contact_preferences);
  addUnique(buckets.price, structuredData.asking_price ? `Asking price: ${structuredData.asking_price}` : "");
  addUnique(buckets.source, source && !/^unknown\b/i.test(source) ? `Lead source: ${source}` : "");

  const entries = [
    ...collectEntries(normalizedPayload.unmapped_data || {}),
    ...collectEntries(normalizedPayload.raw_webhook_payload || {}),
  ];

  entries.forEach(({ key, value }) => {
    if (isNoisyKey(key)) return;
    const cleaned = isSpeedToLead ? cleanSpeedToLeadRecommendedScript(cleanValue(value)) : cleanValue(value);
    if (!cleaned || isLowValue(cleaned)) return;

    const valueKey = cleaned.toLowerCase();
    if (seenValues.has(valueKey)) return;
    seenValues.add(valueKey);

    const section = resolveSection(key, cleaned);
    if (section && buckets[section]) {
      addLabeledUnique(buckets[section], key, cleaned);
    }

    addFlagsFromText(cleaned);
  });

  if (buckets.timeline.some((item) => /\b(today|now|asap|immediately|urgent|quick|fast)\b/i.test(item))) {
    addUnique(buckets.followUp, "Prioritize same-day callback.");
  }
  if (buckets.contact.some((item) => /\b(text|callback|call back|after|morning|evening|spanish)\b/i.test(item))) {
    addUnique(buckets.followUp, "Follow seller contact preference before dialing.");
  }
  if (buckets.condition.length) {
    addUnique(buckets.followUp, "Confirm repair scope and major systems on first call.");
  }
  if (buckets.price.length) {
    addUnique(buckets.followUp, "Confirm asking price, payoff, and lowest acceptable number.");
  }

  const lines = [
    ...buildQuickRead({ structuredData, buckets, flags: buckets.flags }),
    "",
    ...formatList("Seller Summary", buckets.seller),
    "",
    ...formatList("Property Summary", buckets.property),
    "",
    ...formatList("Motivation / Timeline", [...buckets.motivation, ...buckets.timeline]),
    "",
    ...formatList("Property Condition", buckets.condition),
    "",
    ...formatList("Price Expectations", buckets.price),
    "",
    ...formatList("Occupancy", buckets.occupancy),
    "",
    ...formatList("Mortgage / Financial", buckets.financial),
    "",
    ...formatList("Contact Preferences", buckets.contact),
    "",
    ...formatList("Source Information", buckets.source),
    "",
    ...formatList("Important Flags", buckets.flags),
    "",
    ...formatList("Follow-up Guidance", buckets.followUp),
  ];

  return lines
    .filter((line, index, allLines) => line || (allLines[index - 1] && allLines[index + 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  buildAcquisitionsCrmNote,
  cleanValue,
  isLowValue,
  resolveSection,
};
