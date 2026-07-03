const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  createDocumentMock,
  createChromeMock,
  loadScriptInVm,
} = require("./helpers/ui-test-utils");

function loadOptions({ initialStore, sendMessageResponse } = {}) {
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
  ]);

  const chromeMock = createChromeMock({
    initialStore,
    sendMessageResponse,
  });

  loadScriptInVm({
    scriptPath: path.join(__dirname, "..", "options", "options.js"),
    contextValues: {
      document,
      chrome: chromeMock.chrome,
    },
  });

  return { document, elements, ...chromeMock };
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
