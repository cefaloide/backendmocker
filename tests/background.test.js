const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { TextEncoder } = require("node:util");

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
  };
}

function createStorageArea(store, onChangedEvent) {
  function normalizeGetResult(keys) {
    if (Array.isArray(keys)) {
      const result = {};
      for (const key of keys) {
        result[key] = store[key];
      }
      return result;
    }

    if (typeof keys === "string") {
      return { [keys]: store[keys] };
    }

    if (!keys || typeof keys !== "object") {
      return { ...store };
    }

    const result = {};
    for (const [key, fallback] of Object.entries(keys)) {
      result[key] = Object.prototype.hasOwnProperty.call(store, key)
        ? store[key]
        : fallback;
    }

    return result;
  }

  return {
    async get(keys) {
      return normalizeGetResult(keys);
    },
    async set(nextValues) {
      const changes = {};

      for (const [key, newValue] of Object.entries(nextValues)) {
        const oldValue = store[key];
        store[key] = newValue;
        changes[key] = { oldValue, newValue };
      }

      for (const listener of onChangedEvent.listeners) {
        await listener(changes, "local");
      }
    },
  };
}

function createChromeMock(initialStore = {}) {
  const store = { ...initialStore };
  const onInstalled = createEvent();
  const onStartup = createEvent();
  const onMessage = createEvent();
  const onStorageChanged = createEvent();
  const onRuleMatchedDebug = createEvent();

  let dynamicRules = [];

  const chrome = {
    runtime: {
      onInstalled,
      onStartup,
      onMessage,
      getURL(relativePath) {
        return `chrome-extension://test/${relativePath}`;
      },
    },
    storage: {
      onChanged: onStorageChanged,
      local: createStorageArea(store, onStorageChanged),
    },
    declarativeNetRequest: {
      onRuleMatchedDebug,
      async getDynamicRules() {
        return dynamicRules;
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        const removeSet = new Set(removeRuleIds);
        dynamicRules = dynamicRules
          .filter((rule) => !removeSet.has(rule.id))
          .concat(addRules);
      },
    },
    action: {
      async setIcon() {},
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
    },
  };

  return {
    chrome,
    store,
    events: {
      onInstalled,
      onStartup,
      onMessage,
      onStorageChanged,
      onRuleMatchedDebug,
    },
  };
}

function getProjectBackgroundSource() {
  const backgroundPath = path.join(__dirname, "..", "background.js");
  return fs.readFileSync(backgroundPath, "utf8");
}

function loadBackgroundForTest(initialStore = {}) {
  const { chrome, store, events } = createChromeMock(initialStore);

  const context = {
    chrome,
    console,
    TextEncoder,
    btoa(input) {
      return Buffer.from(input, "binary").toString("base64");
    },
    fetch: async () => {
      throw new Error("fetch should not run in these tests");
    },
    OffscreenCanvas: undefined,
    createImageBitmap: undefined,
    Date,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    RegExp,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Map,
    Set,
    Promise,
  };

  vm.createContext(context);
  vm.runInContext(getProjectBackgroundSource(), context, {
    filename: "background.js",
  });

  return { context, store, events };
}

function getOnMessageListener(events) {
  assert.equal(
    events.onMessage.listeners.length > 0,
    true,
    "onMessage listener missing",
  );
  return events.onMessage.listeners[0];
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function callOnMessageReset(onMessageListener) {
  const responsePromise = new Promise((resolve) => {
    onMessageListener({ type: "RESET_CAPTURE_COUNT" }, null, resolve);
  });

  return responsePromise;
}

test("matchInfo with mapped ruleId increments global and mapped rule counters", async () => {
  const initialStore = {
    mockRules: [
      {
        id: "rule-a",
        name: "Rule A",
        enabled: true,
        method: "GET",
        urlPattern: "https://api.example.com/a/*",
        statusCode: 200,
      },
      {
        id: "rule-b",
        name: "Rule B",
        enabled: true,
        method: "POST",
        urlPattern: "https://api.example.com/b/*",
        statusCode: 200,
      },
    ],
    engineEnabled: true,
    capturedCallsCount: 0,
    capturedCallsCountByRule: {},
  };

  const { context, store } = loadBackgroundForTest(initialStore);

  await context.processRuleMatchEvent({
    rule: { ruleId: "1" },
    request: {
      requestId: "req-1",
      tabId: 1,
      frameId: 0,
      url: "https://api.example.com/a/123",
      method: "GET",
    },
    timeStamp: Date.now(),
  });

  assert.equal(store.capturedCallsCount, 1);
  assert.deepEqual(toPlainJson(store.capturedCallsCountByRule), {
    "rule-a": 1,
  });
});

test("unmapped or missing ruleId falls back to URL/method matching", async () => {
  const initialStore = {
    mockRules: [
      {
        id: "rule-a",
        name: "Rule A",
        enabled: true,
        method: "GET",
        urlPattern: "https://api.example.com/a/*",
        statusCode: 200,
      },
      {
        id: "rule-b",
        name: "Rule B",
        enabled: true,
        method: "POST",
        urlPattern: "https://api.example.com/b/*",
        statusCode: 200,
      },
    ],
    engineEnabled: true,
    capturedCallsCount: 0,
    capturedCallsCountByRule: {},
  };

  const { context, store } = loadBackgroundForTest(initialStore);

  await context.processRuleMatchEvent({
    rule: { ruleId: "999" },
    request: {
      requestId: "req-2",
      tabId: 1,
      frameId: 0,
      url: "https://api.example.com/b/42",
      method: "POST",
    },
    timeStamp: Date.now(),
  });

  assert.equal(store.capturedCallsCount, 1);
  assert.deepEqual(toPlainJson(store.capturedCallsCountByRule), {
    "rule-b": 1,
  });
});

test("invalid countByRule state is normalized before increment", async () => {
  const initialStore = {
    mockRules: [
      {
        id: "rule-a",
        name: "Rule A",
        enabled: true,
        method: "GET",
        urlPattern: "https://api.example.com/a/*",
        statusCode: 200,
      },
    ],
    engineEnabled: true,
    capturedCallsCount: -4,
    capturedCallsCountByRule: {
      staleGood: 3,
      staleNegative: -2,
      staleString: "4",
    },
  };

  const { context, store } = loadBackgroundForTest(initialStore);

  await context.processRuleMatchEvent({
    rule: { ruleId: "1" },
    request: {
      requestId: "req-3",
      tabId: 7,
      frameId: 0,
      url: "https://api.example.com/a/9",
      method: "GET",
    },
    timeStamp: Date.now(),
  });

  assert.equal(store.capturedCallsCount, 1);
  assert.deepEqual(toPlainJson(store.capturedCallsCountByRule), {
    staleGood: 3,
    "rule-a": 1,
  });
});

test("RESET_CAPTURE_COUNT clears both global and per-rule counters", async () => {
  const initialStore = {
    mockRules: [],
    engineEnabled: true,
    capturedCallsCount: 12,
    capturedCallsCountByRule: {
      "rule-a": 8,
      "rule-b": 4,
    },
  };

  const { store, events } = loadBackgroundForTest(initialStore);
  const onMessageListener = getOnMessageListener(events);

  const response = await callOnMessageReset(onMessageListener);

  assert.deepEqual(toPlainJson(response), { ok: true, count: 0 });
  assert.equal(store.capturedCallsCount, 0);
  assert.deepEqual(toPlainJson(store.capturedCallsCountByRule), {});
});

test("compileDynamicRules creates redirect + modifyHeaders with intended status", () => {
  const { context } = loadBackgroundForTest();

  const result = context.compileDynamicRules([
    {
      id: "rule-1",
      enabled: true,
      method: "GET",
      urlPattern: "https://api.example.com/items/*",
      statusCode: 503,
      responseHeaders: {
        "Content-Type": "application/json",
        "X-Debug": "yes",
      },
      body: '{"ok":false}',
    },
  ]);

  assert.equal(Array.isArray(result.dynamicRules), true);
  assert.equal(result.dynamicRules.length, 2);

  const redirectRule = result.dynamicRules[0];
  const modifyHeadersRule = result.dynamicRules[1];

  assert.equal(redirectRule.action.type, "redirect");
  assert.equal(
    redirectRule.condition.regexFilter,
    "^https://api\\.example\\.com/items/.*$",
  );
  assert.deepEqual(toPlainJson(redirectRule.condition.requestMethods), ["get"]);

  assert.equal(modifyHeadersRule.action.type, "modifyHeaders");
  assert.deepEqual(toPlainJson(modifyHeadersRule.action.responseHeaders), [
    {
      header: "X-Debug",
      operation: "set",
      value: "yes",
    },
    {
      header: "x-backendmocker-intended-status",
      operation: "set",
      value: "503",
    },
  ]);
});

test("compileDynamicRules keeps only redirect when no extra headers and status 200", () => {
  const { context } = loadBackgroundForTest();

  const result = context.compileDynamicRules([
    {
      id: "rule-2",
      enabled: true,
      method: "ANY",
      urlPattern: "https://api.example.com/health",
      statusCode: 200,
      responseHeaders: {
        "Content-Type": "application/json",
      },
      body: "ok",
    },
  ]);

  assert.equal(result.dynamicRules.length, 1);
  assert.equal(result.dynamicRules[0].action.type, "redirect");
});

test("duplicate requestId matches are deduped and counted once", async () => {
  const initialStore = {
    mockRules: [
      {
        id: "rule-a",
        name: "Rule A",
        enabled: true,
        method: "GET",
        urlPattern: "https://api.example.com/a/*",
        statusCode: 200,
      },
    ],
    engineEnabled: true,
    capturedCallsCount: 0,
    capturedCallsCountByRule: {},
  };

  const { context, store } = loadBackgroundForTest(initialStore);

  const repeatedMatch = {
    rule: { ruleId: "1" },
    request: {
      requestId: "same-request",
      tabId: 3,
      frameId: 0,
      url: "https://api.example.com/a/321",
      method: "GET",
    },
    timeStamp: Date.now(),
  };

  await context.processRuleMatchEvent(repeatedMatch);
  await context.processRuleMatchEvent(repeatedMatch);

  assert.equal(store.capturedCallsCount, 1);
  assert.deepEqual(toPlainJson(store.capturedCallsCountByRule), {
    "rule-a": 1,
  });
});
