const DEFAULT_RECOMMENDED_SCRIPT_PATTERNS = [
  /(?:^|\n)[ \t]*-?[ \t]*call_strategy\s*:[\s\S]*?(?=\n[ \t]*-[ \t]+[a-z0-9_ ]{1,80}:|$)/gi,
  /(?:^|\n)[ \t]*(?:speed\s*to\s*lead\s*)?recommended\s+(?:call\s+)?script\s*:[\s\S]*?(?=\n[ \t]*(?:seller|property|call|agent|lead|contact|motivation|timeline|asking|address|notes?|comments?|details?)\b[^\n:]{0,80}:|\n[ \t]*[-*][ \t]+(?:seller|property|call|agent|lead|contact|motivation|timeline|asking|address|notes?|comments?|details?)\b[^\n:]{0,80}:|$)/gi,
  /(?:^|\n)[ \t]*(?:speed\s*to\s*lead\s*)?(?:opener|pitch|sales|conversation|call)\s+script\s*:[\s\S]*?(?=\n[ \t]*(?:seller|property|call|agent|lead|contact|motivation|timeline|asking|address|notes?|comments?|details?)\b[^\n:]{0,80}:|\n[ \t]*[-*][ \t]+(?:seller|property|call|agent|lead|contact|motivation|timeline|asking|address|notes?|comments?|details?)\b[^\n:]{0,80}:|$)/gi,
];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBlankLines(value) {
  return String(value)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function getConfiguredRecommendedScriptPatterns(scriptText) {
  const configuredText = String(scriptText || process.env.SPEED_TO_LEAD_RECOMMENDED_SCRIPT_TEXT || "").trim();

  if (!configuredText) {
    return [];
  }

  return [new RegExp(escapeRegex(configuredText), "gi")];
}

function cleanSpeedToLeadRecommendedScript(value, options = {}) {
  if (value === null || value === undefined) {
    return "";
  }

  const originalValue = String(value);
  let removedScript = false;
  const patterns = [
    ...getConfiguredRecommendedScriptPatterns(options.exactScriptText),
    ...DEFAULT_RECOMMENDED_SCRIPT_PATTERNS,
  ];

  const cleanedValue = patterns.reduce((currentValue, pattern) => {
    const nextValue = currentValue.replace(pattern, () => {
      removedScript = true;
      return "\n";
    });

    return nextValue;
  }, originalValue);

  return removedScript ? normalizeBlankLines(cleanedValue) : originalValue;
}

function containsSpeedToLeadRecommendedScript(value, options = {}) {
  return cleanSpeedToLeadRecommendedScript(value, options) !== String(value || "");
}

module.exports = {
  cleanSpeedToLeadRecommendedScript,
  containsSpeedToLeadRecommendedScript,
};
