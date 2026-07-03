const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  createDocumentMock,
  createChromeMock,
  loadScriptInVm,
} = require("./helpers/ui-test-utils");

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPopup({ initialStore, sendMessageResponse } = {}) {
  const { document, elements } = createDocumentMock([
    "engineToggle",
    "engineThumb",
    "engineStatus",
    "captureCount",
    "resetCounter",
    "openOptions",
  ]);

  const chromeMock = createChromeMock({
    initialStore,
    sendMessageResponse,
  });

  loadScriptInVm({
    scriptPath: path.join(__dirname, "..", "popup", "popup.js"),
    contextValues: {
      document,
      chrome: chromeMock.chrome,
    },
  });

  return { document, elements, ...chromeMock };
}

test("popup renders initial engine status and captured count from storage", async () => {
  const { document, elements } = loadPopup({
    initialStore: {
      engineEnabled: false,
      capturedCallsCount: 5,
    },
  });

  await document.emit("DOMContentLoaded");

  assert.equal(
    elements.engineStatus.textContent,
    "Mocking is currently disabled.",
  );
  assert.equal(elements.captureCount.textContent, "5");
  assert.equal(elements.resetCounter.disabled, false);
});

test("popup toggle updates storage and sends engine message", async () => {
  const { document, elements, store, sentMessages } = loadPopup({
    initialStore: {
      engineEnabled: true,
      capturedCallsCount: 0,
    },
    sendMessageResponse: { ok: true },
  });

  await document.emit("DOMContentLoaded");
  await elements.engineToggle.trigger("click");

  assert.equal(store.engineEnabled, false);
  assert.deepEqual(toPlainJson(sentMessages[0]), {
    type: "SET_ENGINE_ENABLED",
    enabled: false,
  });
  assert.equal(
    elements.engineStatus.textContent,
    "Mocking is currently disabled.",
  );
});

test("popup reset counter sends reset message and updates chip", async () => {
  const { document, elements, sentMessages } = loadPopup({
    initialStore: {
      engineEnabled: true,
      capturedCallsCount: 7,
    },
    sendMessageResponse(message) {
      if (message.type === "RESET_CAPTURE_COUNT") {
        return { ok: true, count: 0 };
      }
      return { ok: true };
    },
  });

  await document.emit("DOMContentLoaded");
  await elements.resetCounter.trigger("click");

  assert.deepEqual(toPlainJson(sentMessages[0]), {
    type: "RESET_CAPTURE_COUNT",
  });
  assert.equal(elements.captureCount.textContent, "0");
  assert.equal(elements.resetCounter.disabled, true);
});

test("popup open options triggers runtime openOptionsPage", async () => {
  const { document, elements, getOpenOptionsPageCalls } = loadPopup({
    initialStore: {
      engineEnabled: true,
      capturedCallsCount: 0,
    },
  });

  await document.emit("DOMContentLoaded");
  await elements.openOptions.trigger("click");

  assert.equal(getOpenOptionsPageCalls(), 1);
});
