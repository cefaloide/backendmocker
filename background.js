const STORAGE_KEYS = {
  RULES: "mockRules",
  ENGINE_ENABLED: "engineEnabled",
};

const SUPPORTED_RESOURCE_TYPES = ["main_frame", "sub_frame", "xmlhttprequest"];

let activeSyncPromise = null;
let pendingSyncRequested = false;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([
    STORAGE_KEYS.RULES,
    STORAGE_KEYS.ENGINE_ENABLED,
  ]);

  const nextState = {};

  if (!Array.isArray(current[STORAGE_KEYS.RULES])) {
    nextState[STORAGE_KEYS.RULES] = [];
  }

  if (typeof current[STORAGE_KEYS.ENGINE_ENABLED] !== "boolean") {
    nextState[STORAGE_KEYS.ENGINE_ENABLED] = true;
  }

  if (Object.keys(nextState).length > 0) {
    await chrome.storage.local.set(nextState);
  }

  await syncDynamicRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncDynamicRules();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.RULES] || changes[STORAGE_KEYS.ENGINE_ENABLED]) {
    await syncDynamicRules();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "SYNC_RULES") {
    syncDynamicRules()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Failed to sync dynamic mock rules:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "SET_ENGINE_ENABLED") {
    chrome.storage.local
      .set({ [STORAGE_KEYS.ENGINE_ENABLED]: Boolean(message.enabled) })
      .then(() => syncDynamicRules())
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Failed to change mock engine state:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  return false;
});

async function syncDynamicRules() {
  pendingSyncRequested = true;

  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    while (pendingSyncRequested) {
      pendingSyncRequested = false;
      await performDynamicRulesSync();
    }
  })();

  return activeSyncPromise.finally(() => {
    activeSyncPromise = null;
  });
}

async function performDynamicRulesSync() {
  const state = await chrome.storage.local.get([
    STORAGE_KEYS.RULES,
    STORAGE_KEYS.ENGINE_ENABLED,
  ]);

  const allRules = Array.isArray(state[STORAGE_KEYS.RULES])
    ? state[STORAGE_KEYS.RULES]
    : [];
  const engineEnabled = state[STORAGE_KEYS.ENGINE_ENABLED] !== false;

  const enabledRules = engineEnabled
    ? allRules.filter((rule) => Boolean(rule.enabled))
    : [];

  const dynamicRules = compileDynamicRules(enabledRules);
  const existingDynamicRules =
    await chrome.declarativeNetRequest.getDynamicRules();
  const existingRuleIds = existingDynamicRules.map((rule) => rule.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRuleIds,
    addRules: dynamicRules,
  });
}

function compileDynamicRules(rules) {
  const compiled = [];
  let nextRuleId = 1;

  for (const rule of rules) {
    const condition = buildCondition(rule);

    if (!condition) {
      console.warn(
        "Skipping rule because the URL pattern is invalid or empty:",
        rule?.id ?? "<unknown-rule>",
      );
      continue;
    }

    compiled.push(buildRedirectRule(rule, condition, nextRuleId));
    nextRuleId += 1;

    const modifyHeadersRule = buildModifyHeadersRule(
      rule,
      condition,
      nextRuleId,
    );
    if (modifyHeadersRule) {
      compiled.push(modifyHeadersRule);
      nextRuleId += 1;
    }
  }

  return compiled;
}

function buildCondition(rule) {
  if (!rule || typeof rule.urlPattern !== "string") {
    return null;
  }

  const pattern = rule.urlPattern.trim();
  if (!pattern) {
    return null;
  }

  const condition = {
    regexFilter: wildcardToRegex(pattern),
    resourceTypes: SUPPORTED_RESOURCE_TYPES,
  };

  const normalizedMethod = normalizeMethod(rule.method);
  if (normalizedMethod) {
    condition.requestMethods = [normalizedMethod];
  }

  return condition;
}

function buildRedirectRule(rule, condition, id) {
  const headers = normalizeHeaders(rule.responseHeaders);
  const body =
    typeof rule.body === "string" ? rule.body : JSON.stringify(rule.body ?? "");
  const contentType = resolveContentType(headers, body);
  const dataUrl = encodeDataUrl(contentType, body);

  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        url: dataUrl,
      },
    },
    condition,
  };
}

function buildModifyHeadersRule(rule, condition, id) {
  const headers = normalizeHeaders(rule.responseHeaders);
  const responseHeaders = [];

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "content-type") {
      continue;
    }

    responseHeaders.push({
      header: name,
      operation: "set",
      value,
    });
  }

  const normalizedStatusCode = normalizeStatusCode(rule.statusCode);
  if (normalizedStatusCode !== 200) {
    responseHeaders.push({
      header: "x-backendmocker-intended-status",
      operation: "set",
      value: String(normalizedStatusCode),
    });
  }

  if (responseHeaders.length === 0) {
    return null;
  }

  return {
    id,
    priority: 2,
    action: {
      type: "modifyHeaders",
      responseHeaders,
    },
    condition,
  };
}

function normalizeMethod(method) {
  if (typeof method !== "string") {
    return null;
  }

  const normalized = method.trim().toUpperCase();
  if (!normalized || normalized === "ANY") {
    return null;
  }

  return normalized.toLowerCase();
}

function normalizeStatusCode(value) {
  if (Number.isInteger(value) && value >= 100 && value <= 599) {
    return value;
  }

  return 200;
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return {};
  }

  const normalized = {};

  for (const [name, value] of Object.entries(headers)) {
    if (!name.trim()) {
      continue;
    }

    normalized[name] = String(value);
  }

  return normalized;
}

function resolveContentType(headers, body) {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "content-type") {
      return value;
    }
  }

  if (looksLikeJson(body)) {
    return "application/json; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

function looksLikeJson(text) {
  if (typeof text !== "string") {
    return false;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch (_error) {
    return false;
  }
}

function encodeDataUrl(contentType, body) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${contentType};base64,${btoa(binary)}`;
}

function wildcardToRegex(pattern) {
  const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const wildcardPattern = escapedPattern.replace(/\*/g, ".*");
  return `^${wildcardPattern}$`;
}
