const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  createDocumentMock,
  createChromeMock,
  loadScriptInVm,
} = require("./helpers/ui-test-utils");

function loadOptions({
  initialStore,
  sendMessageResponse,
  confirmResponse,
} = {}) {
  const { document, elements } = createDocumentMock([
    "engineHint",
    "formTitle",
    "formError",
    "ruleForm",
    "ruleId",
    "name",
    "method",
    "urlPattern",
    "statusCode",
    "enabled",
    "headers",
    "body",
    "cancelEdit",
    "rulesTableBody",
    "exportRules",
    "importRules",
    "importFileInput",
  ]);

  const chromeMock = createChromeMock({
    initialStore,
    sendMessageResponse,
  });

  const createdObjectUrls = [];
  const revokedObjectUrls = [];
  const blobParts = [];
  const alerts = [];
  const confirms = [];

  class BlobMock {
    constructor(parts) {
      blobParts.push(...parts.map((part) => String(part)));
    }
  }

  const URLMock = {
    createObjectURL(blob) {
      createdObjectUrls.push(blob);
      return "blob:test-url";
    },
    revokeObjectURL(url) {
      revokedObjectUrls.push(url);
    },
  };

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tagName) => {
    const node = originalCreateElement(tagName);
    if (String(tagName).toLowerCase() === "a") {
      node.click = () => {
        node.wasClicked = true;
      };
    }
    return node;
  };

  loadScriptInVm({
    scriptPath: path.join(__dirname, "..", "options", "options.js"),
    contextValues: {
      document,
      chrome: chromeMock.chrome,
      Blob: BlobMock,
      URL: URLMock,
      alert(message) {
        alerts.push(message);
      },
      confirm(message) {
        confirms.push(message);
        if (typeof confirmResponse === "function") {
          return confirmResponse(message);
        }

        return confirmResponse === undefined ? true : Boolean(confirmResponse);
      },
    },
  });

  return {
    document,
    elements,
    ...chromeMock,
    createdObjectUrls,
    revokedObjectUrls,
    blobParts,
    alerts,
    confirms,
  };
}

function countOccurrences(text, term) {
  return text.split(term).length - 1;
}

test("options renders configured rules with captured calls", async () => {
  const { document, elements } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "rule-a",
          name: "Rule A",
          method: "GET",
          urlPattern: "https://api.example.com/a/*",
          statusCode: 200,
          enabled: true,
        },
        {
          id: "rule-b",
          name: "Rule B",
          method: "POST",
          urlPattern: "https://api.example.com/b/*",
          statusCode: 201,
          enabled: true,
        },
      ],
      capturedCallsCountByRule: {
        "rule-a": 3,
        "rule-b": 1,
      },
    },
  });

  await document.emit("DOMContentLoaded");

  const html = elements.rulesTableBody.innerHTML;
  assert.equal(html.includes("Captured calls: 3"), true);
  assert.equal(html.includes("Captured calls: 1"), true);
  assert.equal(countOccurrences(html, "Captured calls:"), 2);
});

test("options updates displayed captured calls on storage change", async () => {
  const { document, elements, chrome } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "rule-a",
          name: "Rule A",
          method: "GET",
          urlPattern: "https://api.example.com/a/*",
          statusCode: 200,
          enabled: true,
        },
      ],
      capturedCallsCountByRule: {
        "rule-a": 1,
      },
    },
  });

  await document.emit("DOMContentLoaded");
  assert.equal(
    elements.rulesTableBody.innerHTML.includes("Captured calls: 1"),
    true,
  );

  await chrome.storage.local.set({
    capturedCallsCountByRule: {
      "rule-a": 4,
    },
  });

  assert.equal(
    elements.rulesTableBody.innerHTML.includes("Captured calls: 4"),
    true,
  );
});

test("options normalizes invalid capturedCallsCountByRule values", async () => {
  const { document, elements } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "rule-a",
          name: "Rule A",
          method: "GET",
          urlPattern: "https://api.example.com/a/*",
          statusCode: 200,
          enabled: true,
        },
      ],
      capturedCallsCountByRule: {
        "rule-a": -10,
      },
    },
  });

  await document.emit("DOMContentLoaded");

  assert.equal(
    elements.rulesTableBody.innerHTML.includes("Captured calls: 0"),
    true,
  );
});

test("options exports configured rules as json", async () => {
  const {
    document,
    elements,
    createdObjectUrls,
    revokedObjectUrls,
    blobParts,
  } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "rule-a",
          name: "Rule A",
          method: "GET",
          urlPattern: "https://api.example.com/a/*",
          statusCode: 200,
          enabled: true,
          responseHeaders: {
            "Content-Type": "application/json",
          },
          body: '{"ok":true}',
        },
      ],
    },
  });

  await document.emit("DOMContentLoaded");
  await elements.exportRules.trigger("click");

  assert.equal(createdObjectUrls.length, 1);
  assert.deepEqual(revokedObjectUrls, ["blob:test-url"]);

  const exportedContent = blobParts.join("");
  const parsed = JSON.parse(exportedContent);

  assert.equal(Array.isArray(parsed.rules), true);
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0].id, "rule-a");
});

test("options imports rules and replaces current ones", async () => {
  const { document, elements, store, alerts, confirms } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "old-rule",
          name: "Old Rule",
          method: "GET",
          urlPattern: "https://api.example.com/old/*",
          statusCode: 200,
          enabled: true,
        },
      ],
    },
  });

  const importedPayload = {
    version: 1,
    rules: [
      {
        id: "new-rule",
        name: "New Rule",
        method: "POST",
        urlPattern: "https://api.example.com/new/*",
        statusCode: 201,
        enabled: false,
        responseHeaders: {
          "X-Test": "1",
        },
        body: '{"created":true}',
      },
    ],
  };

  await document.emit("DOMContentLoaded");
  await elements.importFileInput.trigger("change", {
    target: {
      files: [
        {
          async text() {
            return JSON.stringify(importedPayload);
          },
        },
      ],
    },
  });

  assert.equal(Array.isArray(store.mockRules), true);
  assert.equal(store.mockRules.length, 1);
  assert.equal(store.mockRules[0].id, "new-rule");
  assert.equal(store.mockRules[0].statusCode, 201);
  assert.equal(store.mockRules[0].enabled, false);
  assert.equal(alerts[0], "Imported 1 rule(s).");
  assert.equal(confirms.length, 1);
  assert.equal(elements.rulesTableBody.innerHTML.includes("New Rule"), true);
});

test("options import does not replace rules when confirmation is cancelled", async () => {
  const { document, elements, store, alerts, confirms } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "old-rule",
          name: "Old Rule",
          method: "GET",
          urlPattern: "https://api.example.com/old/*",
          statusCode: 200,
          enabled: true,
        },
      ],
    },
    confirmResponse: false,
  });

  const importedPayload = {
    version: 1,
    rules: [
      {
        id: "new-rule",
        name: "New Rule",
        method: "POST",
        urlPattern: "https://api.example.com/new/*",
        statusCode: 201,
        enabled: false,
      },
    ],
  };

  await document.emit("DOMContentLoaded");
  await elements.importFileInput.trigger("change", {
    target: {
      files: [
        {
          async text() {
            return JSON.stringify(importedPayload);
          },
        },
      ],
    },
  });

  assert.equal(Array.isArray(store.mockRules), true);
  assert.equal(store.mockRules.length, 1);
  assert.equal(store.mockRules[0].id, "old-rule");
  assert.equal(store.mockRules[0].name, "Old Rule");
  assert.equal(confirms.length, 1);
  assert.equal(alerts.length, 0);
  assert.equal(elements.rulesTableBody.innerHTML.includes("Old Rule"), true);
  assert.equal(elements.rulesTableBody.innerHTML.includes("New Rule"), false);
});

test("options shows error for imported rule missing urlPattern", async () => {
  const { document, elements, store, alerts } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "old-rule",
          name: "Old Rule",
          method: "GET",
          urlPattern: "https://api.example.com/old/*",
          statusCode: 200,
          enabled: true,
        },
      ],
    },
  });

  const importedPayload = {
    version: 1,
    rules: [
      {
        id: "new-rule",
        name: "New Rule",
        method: "POST",
        statusCode: 201,
        enabled: false,
      },
    ],
  };

  await document.emit("DOMContentLoaded");
  await elements.importFileInput.trigger("change", {
    target: {
      files: [
        {
          async text() {
            return JSON.stringify(importedPayload);
          },
        },
      ],
    },
  });

  assert.equal(
    elements.formError.textContent,
    "Rule #1 is missing urlPattern.",
  );
  assert.equal(elements.formError.classList.contains("hidden"), false);
  assert.equal(store.mockRules.length, 1);
  assert.equal(store.mockRules[0].id, "old-rule");
  assert.equal(alerts.length, 0);
});

test("options shows error for imported rule with invalid statusCode", async () => {
  const { document, elements, store, alerts } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "old-rule",
          name: "Old Rule",
          method: "GET",
          urlPattern: "https://api.example.com/old/*",
          statusCode: 200,
          enabled: true,
        },
      ],
    },
  });

  const importedPayload = {
    version: 1,
    rules: [
      {
        id: "new-rule",
        name: "New Rule",
        method: "POST",
        urlPattern: "https://api.example.com/new/*",
        statusCode: 700,
        enabled: false,
      },
    ],
  };

  await document.emit("DOMContentLoaded");
  await elements.importFileInput.trigger("change", {
    target: {
      files: [
        {
          async text() {
            return JSON.stringify(importedPayload);
          },
        },
      ],
    },
  });

  assert.equal(
    elements.formError.textContent,
    "Rule #1 has an invalid statusCode. Expected an integer between 100 and 599.",
  );
  assert.equal(elements.formError.classList.contains("hidden"), false);
  assert.equal(store.mockRules.length, 1);
  assert.equal(store.mockRules[0].id, "old-rule");
  assert.equal(alerts.length, 0);
});

test("options shows error for imported rule with invalid responseHeaders", async () => {
  const { document, elements, store, alerts } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [
        {
          id: "old-rule",
          name: "Old Rule",
          method: "GET",
          urlPattern: "https://api.example.com/old/*",
          statusCode: 200,
          enabled: true,
        },
      ],
    },
  });

  const importedPayload = {
    version: 1,
    rules: [
      {
        id: "new-rule",
        name: "New Rule",
        method: "POST",
        urlPattern: "https://api.example.com/new/*",
        statusCode: 201,
        enabled: false,
        responseHeaders: [],
      },
    ],
  };

  await document.emit("DOMContentLoaded");
  await elements.importFileInput.trigger("change", {
    target: {
      files: [
        {
          async text() {
            return JSON.stringify(importedPayload);
          },
        },
      ],
    },
  });

  assert.equal(
    elements.formError.textContent,
    "Rule #1 has invalid responseHeaders.",
  );
  assert.equal(elements.formError.classList.contains("hidden"), false);
  assert.equal(store.mockRules.length, 1);
  assert.equal(store.mockRules[0].id, "old-rule");
  assert.equal(alerts.length, 0);
});

test("options shows error for invalid import file format", async () => {
  const { document, elements, store } = loadOptions({
    initialStore: {
      engineEnabled: true,
      mockRules: [],
    },
  });

  await document.emit("DOMContentLoaded");
  await elements.importFileInput.trigger("change", {
    target: {
      files: [
        {
          async text() {
            return JSON.stringify({ notRules: [] });
          },
        },
      ],
    },
  });

  assert.equal(
    elements.formError.textContent,
    "Invalid import format. Expected a JSON array or object with a rules array.",
  );
  assert.equal(elements.formError.classList.contains("hidden"), false);
  assert.equal(Array.isArray(store.mockRules), true);
  assert.equal(store.mockRules.length, 0);
});
