const STORAGE_KEYS = {
  RULES: "mockRules",
  ENGINE_ENABLED: "engineEnabled",
  CAPTURE_COUNT_BY_RULE: "capturedCallsCountByRule",
};

const ALLOWED_METHODS = new Set([
  "ANY",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const state = {
  rules: [],
  editingRuleId: null,
  engineEnabled: true,
  captureCountByRule: {},
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  wireEvents();
  await loadState();
  render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE]) {
    state.captureCountByRule = normalizeCaptureCountByRule(
      changes[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE].newValue,
    );
    renderRulesTable();
  }
});

function cacheElements() {
  elements.engineHint = document.getElementById("engineHint");
  elements.formTitle = document.getElementById("formTitle");
  elements.formError = document.getElementById("formError");
  elements.ruleForm = document.getElementById("ruleForm");
  elements.ruleId = document.getElementById("ruleId");
  elements.name = document.getElementById("name");
  elements.method = document.getElementById("method");
  elements.urlPattern = document.getElementById("urlPattern");
  elements.statusCode = document.getElementById("statusCode");
  elements.enabled = document.getElementById("enabled");
  elements.headers = document.getElementById("headers");
  elements.body = document.getElementById("body");
  elements.cancelEdit = document.getElementById("cancelEdit");
  elements.rulesTableBody = document.getElementById("rulesTableBody");
  elements.exportRules = document.getElementById("exportRules");
  elements.importRules = document.getElementById("importRules");
  elements.importFileInput = document.getElementById("importFileInput");
}

function wireEvents() {
  elements.ruleForm.addEventListener("submit", onSubmitRuleForm);
  elements.cancelEdit.addEventListener("click", resetForm);
  elements.rulesTableBody.addEventListener("click", onRulesTableClick);
  elements.exportRules.addEventListener("click", onExportRules);
  elements.importRules.addEventListener("click", onImportRulesClick);
  elements.importFileInput.addEventListener("change", onImportFileChange);
}

async function loadState() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.RULES,
    STORAGE_KEYS.ENGINE_ENABLED,
    STORAGE_KEYS.CAPTURE_COUNT_BY_RULE,
  ]);

  state.rules = Array.isArray(result[STORAGE_KEYS.RULES])
    ? result[STORAGE_KEYS.RULES]
    : [];
  state.engineEnabled = result[STORAGE_KEYS.ENGINE_ENABLED] !== false;
  state.captureCountByRule = normalizeCaptureCountByRule(
    result[STORAGE_KEYS.CAPTURE_COUNT_BY_RULE],
  );
}

function render() {
  renderEngineHint();
  renderRulesTable();
  renderFormMode();
  renderImportExportButtons();
}

function renderImportExportButtons() {
  const hasRules = state.rules.length > 0;
  elements.exportRules.disabled = !hasRules;

  if (hasRules) {
    elements.exportRules.classList.remove("opacity-60", "cursor-not-allowed");
  } else {
    elements.exportRules.classList.add("opacity-60", "cursor-not-allowed");
  }
}

function renderEngineHint() {
  if (state.engineEnabled) {
    elements.engineHint.textContent = "Global engine status: enabled";
    elements.engineHint.classList.remove(
      "border-amber-300",
      "bg-amber-50",
      "text-amber-800",
    );
    elements.engineHint.classList.add(
      "border-emerald-300",
      "bg-emerald-50",
      "text-emerald-800",
    );
  } else {
    elements.engineHint.textContent =
      "Global engine status: disabled (enable it from the popup to apply rules)";
    elements.engineHint.classList.remove(
      "border-emerald-300",
      "bg-emerald-50",
      "text-emerald-800",
    );
    elements.engineHint.classList.add(
      "border-amber-300",
      "bg-amber-50",
      "text-amber-800",
    );
  }
}

function renderRulesTable() {
  if (state.rules.length === 0) {
    elements.rulesTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="px-4 py-8 text-center text-sm text-slate-500">
          No rules yet. Create your first mock rule above.
        </td>
      </tr>
    `;
    return;
  }

  const rows = state.rules
    .map((rule) => {
      const safeName = escapeHtml(rule.name || `${rule.method || "ANY"} rule`);
      const safeMethod = escapeHtml(rule.method || "ANY");
      const safePattern = escapeHtml(rule.urlPattern || "");
      const safeStatus = escapeHtml(String(rule.statusCode || 200));
      const isEnabled = rule.enabled !== false;
      const capturedCalls = normalizeCaptureCount(
        state.captureCountByRule?.[rule.id],
      );

      return `
        <tr data-rule-id="${escapeHtml(rule.id)}">
          <td class="px-4 py-3 align-top">
            <p class="text-sm font-medium text-slate-900">${safeName}</p>
            <p class="text-xs text-slate-500 mt-1">Captured calls: ${capturedCalls}</p>
          </td>
          <td class="px-4 py-3 align-top">
            <p class="text-xs text-slate-500">${safeMethod}</p>
            <p class="text-sm break-all">${safePattern}</p>
          </td>
          <td class="px-4 py-3 align-top">
            <p class="text-sm">HTTP ${safeStatus}</p>
          </td>
          <td class="px-4 py-3 align-top text-center">
            <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
              isEnabled
                ? "bg-green-100 text-emerald-700"
                : "bg-gray-200 text-slate-700"
            }">
              ${isEnabled ? "Enabled" : "Disabled"}
            </span>
          </td>
          <td class="px-4 py-3 align-top text-right">
            <div class="flex flex-col gap-2">
              <button
                type="button"
                data-action="edit"
                data-id="${escapeHtml(rule.id)}"
                class="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100"
              >
                Edit
              </button>
              <button
                type="button"
                data-action="toggle"
                data-id="${escapeHtml(rule.id)}"
                class="rounded-md border border-blue-300 text-blue-700 px-2.5 py-1 text-xs font-medium hover:bg-blue-50"
              >
                ${isEnabled ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                data-action="delete"
                data-id="${escapeHtml(rule.id)}"
                class="rounded-md border border-red-300 text-red-700 px-2.5 py-1 text-xs font-medium hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.rulesTableBody.innerHTML = rows;
}

function renderFormMode() {
  elements.formTitle.textContent = state.editingRuleId
    ? "Edit mock rule"
    : "Create mock rule";
}

async function onSubmitRuleForm(event) {
  event.preventDefault();
  clearError();

  const urlPattern = elements.urlPattern.value.trim();
  if (!urlPattern) {
    showError("URL pattern is required.");
    return;
  }

  const statusCode = Number(elements.statusCode.value);
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    showError("Status code must be an integer between 100 and 599.");
    return;
  }

  const parsedHeaders = parseHeadersInput(elements.headers.value);
  if (parsedHeaders === null) {
    return;
  }

  const method = elements.method.value;
  const displayName = elements.name.value.trim() || `${method} ${urlPattern}`;
  const now = new Date().toISOString();

  const draftRule = {
    id: state.editingRuleId || generateRuleId(),
    name: displayName,
    method,
    urlPattern,
    statusCode,
    responseHeaders: parsedHeaders,
    body: elements.body.value,
    enabled: elements.enabled.value === "true",
    updatedAt: now,
  };

  if (state.editingRuleId) {
    const targetIndex = state.rules.findIndex(
      (rule) => rule.id === state.editingRuleId,
    );
    if (targetIndex === -1) {
      showError("The rule you are editing no longer exists.");
      return;
    }

    draftRule.createdAt = state.rules[targetIndex].createdAt || now;
    state.rules[targetIndex] = draftRule;
  } else {
    draftRule.createdAt = now;
    state.rules.push(draftRule);
  }

  await saveRules();
  resetForm();
  render();
}

function parseHeadersInput(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_error) {
    showError("Response headers must be valid JSON.");
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    showError("Response headers must be a JSON object.");
    return null;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(parsed)) {
    const headerName = key.trim();
    if (!headerName) {
      continue;
    }

    normalized[headerName] = String(value);
  }

  return normalized;
}

async function onRulesTableClick(event) {
  const trigger = event.target.closest("button[data-action]");
  if (!trigger) {
    return;
  }

  const action = trigger.dataset.action;
  const ruleId = trigger.dataset.id;
  const targetRule = state.rules.find((rule) => rule.id === ruleId);

  if (!targetRule) {
    showError("Could not find the selected rule.");
    return;
  }

  if (action === "edit") {
    startEditingRule(targetRule);
    return;
  }

  if (action === "toggle") {
    targetRule.enabled = !targetRule.enabled;
    targetRule.updatedAt = new Date().toISOString();
    await saveRules();
    render();
    return;
  }

  if (action === "delete") {
    const shouldDelete = confirm(`Delete rule "${targetRule.name}"?`);
    if (!shouldDelete) {
      return;
    }

    state.rules = state.rules.filter((rule) => rule.id !== ruleId);
    if (state.editingRuleId === ruleId) {
      resetForm();
    }

    await saveRules();
    render();
  }
}

function startEditingRule(rule) {
  clearError();
  state.editingRuleId = rule.id;
  elements.ruleId.value = rule.id;
  elements.name.value = rule.name || "";
  elements.method.value = rule.method || "ANY";
  elements.urlPattern.value = rule.urlPattern || "";
  elements.statusCode.value = String(rule.statusCode || 200);
  elements.enabled.value = rule.enabled === false ? "false" : "true";
  elements.headers.value = JSON.stringify(rule.responseHeaders || {}, null, 2);
  elements.body.value = rule.body || "";
  renderFormMode();
  elements.urlPattern.focus();
}

function resetForm() {
  clearError();
  state.editingRuleId = null;
  elements.ruleForm.reset();
  elements.ruleId.value = "";
  elements.method.value = "ANY";
  elements.statusCode.value = "200";
  elements.enabled.value = "true";
  renderFormMode();
}

async function saveRules() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.RULES]: state.rules,
  });

  await chrome.runtime.sendMessage({ type: "SYNC_RULES" });
}

async function onExportRules() {
  clearError();

  if (state.rules.length === 0) {
    showError("No rules available to export.");
    return;
  }

  if (
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    showError("Export is not supported in this environment.");
    return;
  }

  const exportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: state.rules,
  };
  const exportJson = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([exportJson], { type: "application/json" });
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let fileUrl = "";

  try {
    fileUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = fileUrl;
    link.download = `backendmocker-rules-${safeTimestamp}.json`;
    link.click();
  } catch (_error) {
    showError("Could not export rules file.");
  } finally {
    if (fileUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(fileUrl);
    }
  }
}

function onImportRulesClick() {
  clearError();
  elements.importFileInput.value = "";
  elements.importFileInput.click();
}

async function onImportFileChange(event) {
  clearError();

  const selectedFile = event.target?.files?.[0];
  if (!selectedFile) {
    return;
  }

  try {
    const rawContent = await readFileContent(selectedFile);
    const parsedContent = JSON.parse(rawContent);
    const importedRules = extractImportedRules(parsedContent);

    if (importedRules.length === 0) {
      showError("The selected file does not contain any rules.");
      return;
    }

    const shouldReplace = confirm(
      `Import ${importedRules.length} rule(s) and replace ${state.rules.length} current rule(s)? This cannot be undone.`,
    );

    if (!shouldReplace) {
      return;
    }

    state.rules = normalizeImportedRules(importedRules);
    await saveRules();
    resetForm();
    render();

    if (typeof alert === "function") {
      alert(`Imported ${state.rules.length} rule(s).`);
    }
  } catch (error) {
    showError(error?.message || "Could not import the selected rules file.");
  } finally {
    elements.importFileInput.value = "";
  }
}

async function readFileContent(file) {
  if (typeof file.text === "function") {
    return file.text();
  }

  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read selected file."));
      reader.readAsText(file);
    });
  }

  throw new Error("Could not read selected file.");
}

function extractImportedRules(parsedContent) {
  if (Array.isArray(parsedContent)) {
    return parsedContent;
  }

  if (
    parsedContent &&
    typeof parsedContent === "object" &&
    Array.isArray(parsedContent.rules)
  ) {
    return parsedContent.rules;
  }

  throw new Error(
    "Invalid import format. Expected a JSON array or object with a rules array.",
  );
}

function normalizeImportedRules(importedRules) {
  const seenRuleIds = new Set();
  return importedRules.map((rule, index) =>
    normalizeImportedRule(rule, index, seenRuleIds),
  );
}

function normalizeImportedRule(rule, index, seenRuleIds) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new Error(`Rule #${index + 1} is not a valid object.`);
  }

  const urlPattern = String(rule.urlPattern || "").trim();
  if (!urlPattern) {
    throw new Error(`Rule #${index + 1} is missing urlPattern.`);
  }

  const method = normalizeRuleMethod(rule.method);
  const statusCode = normalizeRuleStatusCode(rule.statusCode, index);
  const responseHeaders = normalizeRuleHeaders(rule.responseHeaders, index);
  const now = new Date().toISOString();

  const rawId = typeof rule.id === "string" ? rule.id.trim() : "";
  const uniqueId = rawId && !seenRuleIds.has(rawId) ? rawId : generateRuleId();
  seenRuleIds.add(uniqueId);

  const displayName =
    typeof rule.name === "string" && rule.name.trim()
      ? rule.name.trim()
      : `${method} ${urlPattern}`;

  const body =
    typeof rule.body === "string"
      ? rule.body
      : rule.body == null
        ? ""
        : JSON.stringify(rule.body);

  const createdAt =
    typeof rule.createdAt === "string" && rule.createdAt ? rule.createdAt : now;
  const updatedAt =
    typeof rule.updatedAt === "string" && rule.updatedAt ? rule.updatedAt : now;

  return {
    id: uniqueId,
    name: displayName,
    method,
    urlPattern,
    statusCode,
    responseHeaders,
    body,
    enabled: rule.enabled !== false,
    createdAt,
    updatedAt,
  };
}

function normalizeRuleMethod(method) {
  const normalizedMethod = String(method || "ANY").toUpperCase();
  return ALLOWED_METHODS.has(normalizedMethod) ? normalizedMethod : "ANY";
}

function normalizeRuleStatusCode(statusCode, ruleIndex) {
  const normalizedStatusCode = Number(statusCode);

  if (
    !Number.isInteger(normalizedStatusCode) ||
    normalizedStatusCode < 100 ||
    normalizedStatusCode > 599
  ) {
    throw new Error(
      `Rule #${ruleIndex + 1} has an invalid statusCode. Expected an integer between 100 and 599.`,
    );
  }

  return normalizedStatusCode;
}

function normalizeRuleHeaders(headers, ruleIndex) {
  if (headers == null) {
    return {};
  }

  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw new Error(`Rule #${ruleIndex + 1} has invalid responseHeaders.`);
  }

  const normalizedHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    const headerName = String(key).trim();
    if (!headerName) {
      continue;
    }

    normalizedHeaders[headerName] = String(value);
  }

  return normalizedHeaders;
}

function showError(message) {
  elements.formError.textContent = message;
  elements.formError.classList.remove("hidden");
}

function clearError() {
  elements.formError.textContent = "";
  elements.formError.classList.add("hidden");
}

function generateRuleId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeCaptureCount(value) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }

  return 0;
}

function normalizeCaptureCountByRule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};

  for (const [ruleId, count] of Object.entries(value)) {
    if (!ruleId) {
      continue;
    }

    normalized[ruleId] = normalizeCaptureCount(count);
  }

  return normalized;
}
