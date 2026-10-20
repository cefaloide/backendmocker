const STORAGE_KEYS = {
  RULES: "mockRules",
  ENGINE_ENABLED: "engineEnabled",
  CAPTURE_COUNT: "capturedCallsCount",
  CAPTURE_COUNT_BY_RULE: "capturedCallsCountByRule",
};

const SUPPORTED_RESOURCE_TYPES = ["main_frame", "sub_frame", "xmlhttprequest"];
const MATCH_DEDUP_TTL_MS = 15_000;
const ACTION_ICON_SOURCE_PATH = "icons/icon128.png";
const ACTION_ICON_SIZES = [16, 32];

let activeSyncPromise = null;
let pendingSyncRequested = false;
let captureCountCache = null;
let captureCountByRuleCache = null;
let captureCountWriteQueue = Promise.resolve();
let actionIconBitmapPromise = null;
let engineEnabledCache = null;
let dynamicRuleIdToSourceRuleId = new Map();
let syncedEnabledRules = [];
let ensureRuleMatchContextPromise = null;
let ruleMatchContextLoaded = false;

const recentMatchedRequests = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([
    STORAGE_KEYS.RULES,
    STORAGE_KEYS.ENGINE_ENABLED,
    STORAGE_KEYS.CAPTURE_COUNT,
    STORAGE_KEYS.CAPTURE_COUNT_BY_RULE,
  ]);

  const nextState = {};

  if (!Array.isArray(current[STORAGE_KEYS.RULES])) {
    nextState[STORAGE_KEYS.RULES] = [];
  }

  if (typeof current[STORAGE_KEYS.ENGINE_ENABLED] !== "boolean") {
    nextState[STORAGE_KEYS.ENGINE_ENABLED] = true;
  }

  if (!isValidCaptureCount(current[STORAGE_KEYS.CAPTURE_COUNT])) {
    nextState[STORAGE_KEYS.CAPTURE_COUNT] = 0;
  }

  if (!isValidCaptureCountByRule(current[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE])) {
    nextState[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE] = {};
  }

  captureCountCache = normalizeCaptureCount(
    current[STORAGE_KEYS.CAPTURE_COUNT],
  );
  captureCountByRuleCache = normalizeCaptureCountByRule(
    current[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE],
  );
  engineEnabledCache = current[STORAGE_KEYS.ENGINE_ENABLED] !== false;

  if (Object.keys(nextState).length > 0) {
    await chrome.storage.local.set(nextState);

    if (
      Object.prototype.hasOwnProperty.call(
        nextState,
        STORAGE_KEYS.CAPTURE_COUNT,
      )
    ) {
      captureCountCache = nextState[STORAGE_KEYS.CAPTURE_COUNT];
    }

    if (
      Object.prototype.hasOwnProperty.call(
        nextState,
        STORAGE_KEYS.CAPTURE_COUNT_BY_RULE,
      )
    ) {
      captureCountByRuleCache = nextState[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE];
    }
  }

  await syncDynamicRules();
  await updateActionBadge(captureCountCache);
});

chrome.runtime.onStartup.addListener(async () => {
  await syncDynamicRules();
  const engineEnabled = await getEngineEnabled();
  const captureCount = await getCaptureCount();
  engineEnabledCache = engineEnabled;
  await updateActionBadge(captureCount);
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.RULES] || changes[STORAGE_KEYS.ENGINE_ENABLED]) {
    await syncDynamicRules();
  }

  if (changes[STORAGE_KEYS.ENGINE_ENABLED]) {
    engineEnabledCache =
      changes[STORAGE_KEYS.ENGINE_ENABLED].newValue !== false;
    const captureCount = await getCaptureCount();
    await updateActionBadge(captureCount);
  }

  if (changes[STORAGE_KEYS.CAPTURE_COUNT]) {
    captureCountCache = normalizeCaptureCount(
      changes[STORAGE_KEYS.CAPTURE_COUNT].newValue,
    );
    await updateActionBadge(captureCountCache);
  }

  if (changes[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE]) {
    captureCountByRuleCache = normalizeCaptureCountByRule(
      changes[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE].newValue,
    );
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

  if (message.type === "GET_CAPTURE_COUNT") {
    getCaptureCount()
      .then((count) => sendResponse({ ok: true, count }))
      .catch((error) => {
        console.error("Failed to read captured calls counter:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "RESET_CAPTURE_COUNT") {
    queueCaptureCountersUpdate(() => ({ count: 0, countByRule: {} }))
      .then((count) => sendResponse({ ok: true, count }))
      .catch((error) => {
        console.error("Failed to reset captured calls counter:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  return false;
});

registerRuleMatchedListener();
void initializeActionBadge();

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
  syncedEnabledRules = enabledRules;

  const { dynamicRules, ruleIdMap } = compileDynamicRules(enabledRules);
  dynamicRuleIdToSourceRuleId = ruleIdMap;
  ruleMatchContextLoaded = true;
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
  const ruleIdMap = new Map();
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

    const sourceRuleId =
      typeof rule?.id === "string" || typeof rule?.id === "number"
        ? String(rule.id)
        : null;

    compiled.push(buildRedirectRule(rule, condition, nextRuleId));
    if (sourceRuleId) {
      ruleIdMap.set(String(nextRuleId), sourceRuleId);
    }
    nextRuleId += 1;

    const modifyHeadersRule = buildModifyHeadersRule(
      rule,
      condition,
      nextRuleId,
    );
    if (modifyHeadersRule) {
      compiled.push(modifyHeadersRule);
      if (sourceRuleId) {
        ruleIdMap.set(String(nextRuleId), sourceRuleId);
      }
      nextRuleId += 1;
    }
  }

  return { dynamicRules: compiled, ruleIdMap };
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

function isValidCaptureCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeCaptureCount(value) {
  return isValidCaptureCount(value) ? value : 0;
}

function isValidCaptureCountByRule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(isValidCaptureCount);
}

function normalizeCaptureCountByRule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};

  for (const [ruleId, count] of Object.entries(value)) {
    if (!ruleId || !isValidCaptureCount(count)) {
      continue;
    }

    normalized[ruleId] = count;
  }

  return normalized;
}

function formatBadgeText(count) {
  if (count <= 0) {
    return "";
  }

  if (count > 999) {
    return "999+";
  }

  return String(count);
}

async function getCaptureCount() {
  if (isValidCaptureCount(captureCountCache)) {
    return captureCountCache;
  }

  const state = await chrome.storage.local.get(STORAGE_KEYS.CAPTURE_COUNT);
  captureCountCache = normalizeCaptureCount(state[STORAGE_KEYS.CAPTURE_COUNT]);
  return captureCountCache;
}

async function getCaptureCountByRule() {
  if (captureCountByRuleCache && typeof captureCountByRuleCache === "object") {
    return captureCountByRuleCache;
  }

  const state = await chrome.storage.local.get(
    STORAGE_KEYS.CAPTURE_COUNT_BY_RULE,
  );
  captureCountByRuleCache = normalizeCaptureCountByRule(
    state[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE],
  );
  return captureCountByRuleCache;
}

async function getEngineEnabled() {
  if (typeof engineEnabledCache === "boolean") {
    return engineEnabledCache;
  }

  const state = await chrome.storage.local.get(STORAGE_KEYS.ENGINE_ENABLED);
  engineEnabledCache = state[STORAGE_KEYS.ENGINE_ENABLED] !== false;
  return engineEnabledCache;
}

function queueCaptureCountUpdate(updateFn) {
  return queueCaptureCountersUpdate((currentState) => ({
    count: updateFn(currentState.count),
  }));
}

function queueCaptureCountersUpdate(updateFn) {
  captureCountWriteQueue = captureCountWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const currentState = {
        count: await getCaptureCount(),
        countByRule: await getCaptureCountByRule(),
      };

      const update = updateFn(currentState) || {};
      const nextCount = normalizeCaptureCount(
        update.count ?? currentState.count,
      );
      const nextCountByRule = normalizeCaptureCountByRule(
        update.countByRule ?? currentState.countByRule,
      );

      captureCountCache = nextCount;
      captureCountByRuleCache = nextCountByRule;
      await chrome.storage.local.set({
        [STORAGE_KEYS.CAPTURE_COUNT]: nextCount,
        [STORAGE_KEYS.CAPTURE_COUNT_BY_RULE]: nextCountByRule,
      });
      await updateActionBadge(nextCount);

      return nextCount;
    });

  return captureCountWriteQueue;
}

async function updateActionBadge(count) {
  const normalizedCount = normalizeCaptureCount(count);
  const engineEnabled = await getEngineEnabled();

  if (canDrawCounterInActionIcon()) {
    try {
      const imageData = await createActionIconImageData(
        normalizedCount,
        engineEnabled,
      );
      await chrome.action.setIcon({ imageData });
      await chrome.action.setBadgeText({ text: "" });
      return;
    } catch (error) {
      console.error(
        "Failed to render counter in action icon. Falling back to badge text:",
        error,
      );
    }
  }

  await chrome.action.setBadgeBackgroundColor({
    color: engineEnabled ? "#0f766e" : "#6b7280",
  });
  await chrome.action.setBadgeText({ text: formatBadgeText(normalizedCount) });
}

async function initializeActionBadge() {
  try {
    const captureCount = await getCaptureCount();
    await updateActionBadge(captureCount);
  } catch (error) {
    console.error("Failed to initialize action badge:", error);
  }
}

function registerRuleMatchedListener() {
  // onRuleMatchedDebug is only available for unpacked extensions, so packed
  // (Chrome Web Store) builds observe requests through webRequest instead.
  const beforeRequestEvent = chrome.webRequest?.onBeforeRequest;
  if (beforeRequestEvent) {
    beforeRequestEvent.addListener(
      (details) => {
        void processWebRequestEvent(details);
      },
      { urls: ["<all_urls>"], types: SUPPORTED_RESOURCE_TYPES },
    );
    return;
  }

  const ruleMatchedEvent = chrome.declarativeNetRequest?.onRuleMatchedDebug;
  if (!ruleMatchedEvent) {
    return;
  }

  ruleMatchedEvent.addListener((matchInfo) => {
    void processRuleMatchEvent(matchInfo);
  });
}

async function processWebRequestEvent(details) {
  await ensureRuleMatchContextReady();

  const matchInfo = { request: details, timeStamp: details?.timeStamp };
  if (!resolveSourceRuleIdFromMatch(matchInfo)) {
    return;
  }

  await processRuleMatchEvent(matchInfo);
}

async function processRuleMatchEvent(matchInfo) {
  if (!shouldCountRuleMatch(matchInfo)) {
    return;
  }

  await ensureRuleMatchContextReady();
  const sourceRuleId = resolveSourceRuleIdFromMatch(matchInfo);

  await queueCaptureCountersUpdate((currentState) => {
    const nextCountByRule = { ...currentState.countByRule };

    if (sourceRuleId) {
      const currentRuleCount = normalizeCaptureCount(
        nextCountByRule[sourceRuleId],
      );
      nextCountByRule[sourceRuleId] = currentRuleCount + 1;
    }

    return {
      count: currentState.count + 1,
      countByRule: nextCountByRule,
    };
  }).catch((error) => {
    console.error("Failed to increment captured calls counter:", error);
  });
}

async function ensureRuleMatchContextReady() {
  if (ruleMatchContextLoaded) {
    return;
  }

  if (!ensureRuleMatchContextPromise) {
    ensureRuleMatchContextPromise = syncDynamicRules()
      .catch((error) => {
        console.error("Failed to initialize rule match context:", error);
      })
      .finally(() => {
        ensureRuleMatchContextPromise = null;
      });
  }

  await ensureRuleMatchContextPromise;
}

function resolveSourceRuleIdFromMatch(matchInfo) {
  const dynamicRuleId = normalizeDynamicRuleId(matchInfo?.rule?.ruleId);
  if (dynamicRuleId && dynamicRuleIdToSourceRuleId.has(dynamicRuleId)) {
    return dynamicRuleIdToSourceRuleId.get(dynamicRuleId) || null;
  }

  const request = matchInfo?.request;
  if (!request || typeof request !== "object") {
    return null;
  }

  const requestUrl = typeof request.url === "string" ? request.url : "";
  if (!requestUrl) {
    return null;
  }

  const requestMethod =
    typeof request.method === "string" ? request.method.toUpperCase() : "ANY";

  for (const rule of syncedEnabledRules) {
    if (!rule || (typeof rule.id !== "string" && typeof rule.id !== "number")) {
      continue;
    }

    const ruleMethod =
      typeof rule.method === "string" ? rule.method.toUpperCase() : "ANY";
    if (ruleMethod !== "ANY" && ruleMethod !== requestMethod) {
      continue;
    }

    if (!doesRuleUrlPatternMatchRequest(rule.urlPattern, requestUrl)) {
      continue;
    }

    return String(rule.id);
  }

  return null;
}

function normalizeDynamicRuleId(value) {
  if (Number.isInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value;
  }

  return null;
}

function doesRuleUrlPatternMatchRequest(urlPattern, requestUrl) {
  if (typeof urlPattern !== "string") {
    return false;
  }

  const pattern = urlPattern.trim();
  if (!pattern) {
    return false;
  }

  try {
    const regex = new RegExp(wildcardToRegex(pattern));
    return regex.test(requestUrl);
  } catch (_error) {
    return false;
  }
}

function shouldCountRuleMatch(matchInfo) {
  const request = matchInfo?.request;
  if (!request || typeof request !== "object") {
    return true;
  }

  const requestKey = buildRequestKey(matchInfo, request);
  if (!requestKey) {
    return true;
  }

  const now = Date.now();

  for (const [key, timestamp] of recentMatchedRequests.entries()) {
    if (now - timestamp > MATCH_DEDUP_TTL_MS) {
      recentMatchedRequests.delete(key);
    }
  }

  if (recentMatchedRequests.has(requestKey)) {
    return false;
  }

  recentMatchedRequests.set(requestKey, now);
  return true;
}

function buildRequestKey(matchInfo, request) {
  if (typeof request.requestId === "string" && request.requestId) {
    return `${request.requestId}:${request.tabId ?? -1}:${request.frameId ?? -1}`;
  }

  if (typeof request.url === "string" && request.url) {
    const timeBucket = Math.floor(
      Number(matchInfo?.timeStamp ?? Date.now()) / 100,
    );
    return `${request.method ?? "ANY"}:${request.url}:${timeBucket}`;
  }

  return null;
}

function canDrawCounterInActionIcon() {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function"
  );
}

async function getActionIconBitmap() {
  if (!actionIconBitmapPromise) {
    actionIconBitmapPromise = (async () => {
      const iconUrl = chrome.runtime.getURL(ACTION_ICON_SOURCE_PATH);
      const response = await fetch(iconUrl);

      if (!response.ok) {
        throw new Error(`Could not load icon from ${ACTION_ICON_SOURCE_PATH}`);
      }

      const blob = await response.blob();
      return createImageBitmap(blob);
    })();
  }

  return actionIconBitmapPromise;
}

async function createActionIconImageData(count, engineEnabled) {
  const normalizedCount = normalizeCaptureCount(count);
  const shouldRenderGrayscale = !engineEnabled;
  const baseIconBitmap = await getActionIconBitmap();
  const imageData = {};

  for (const size of ACTION_ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d", { alpha: true });

    if (!context) {
      throw new Error("Could not create 2D context for action icon rendering.");
    }

    context.clearRect(0, 0, size, size);
    context.drawImage(baseIconBitmap, 0, 0, size, size);
    drawCounterBubble(context, size, normalizedCount);

    if (shouldRenderGrayscale) {
      applyGrayscaleFilter(context, size);
    }

    imageData[size] = context.getImageData(0, 0, size, size);
  }

  return imageData;
}

function drawCounterBubble(context, iconSize, count) {
  if (count <= 0) {
    return;
  }

  const bubbleText = formatIconCounterText(count, iconSize);
  if (!bubbleText) {
    return;
  }

  const bubbleDiameter = iconSize <= 16 ? 11 : 20;
  const bubbleRadius = bubbleDiameter / 2;
  const centerX = iconSize - bubbleRadius;
  const centerY = bubbleRadius;

  context.beginPath();
  context.fillStyle = "#dc2626";
  context.arc(centerX, centerY, bubbleRadius, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = Math.max(1, Math.round(iconSize * 0.06));
  context.strokeStyle = "#ffffff";
  context.stroke();

  const fontSize = resolveIconCounterFontSize(iconSize, bubbleText.length);
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${fontSize}px sans-serif`;
  context.fillText(bubbleText, centerX, centerY + (iconSize <= 16 ? 0.5 : 0));
}

function formatIconCounterText(count, iconSize) {
  if (count <= 0) {
    return "";
  }

  if (count <= 99) {
    return String(count);
  }

  return iconSize <= 16 ? "99" : "99+";
}

function resolveIconCounterFontSize(iconSize, textLength) {
  if (iconSize <= 16) {
    if (textLength >= 3) {
      return 6;
    }

    if (textLength === 2) {
      return 7;
    }

    return 8;
  }

  if (textLength >= 3) {
    return 10;
  }

  if (textLength === 2) {
    return 12;
  }

  return 14;
}

function applyGrayscaleFilter(context, iconSize) {
  const pixels = context.getImageData(0, 0, iconSize, iconSize);
  const data = pixels.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

    data[i] = luminance;
    data[i + 1] = luminance;
    data[i + 2] = luminance;
  }

  context.putImageData(pixels, 0, 0);
}
