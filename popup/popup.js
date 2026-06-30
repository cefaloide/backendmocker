const STORAGE_KEYS = {
  ENGINE_ENABLED: "engineEnabled",
  CAPTURE_COUNT: "capturedCallsCount",
};

const engineToggle = document.getElementById("engineToggle");
const engineThumb = document.getElementById("engineThumb");
const engineStatus = document.getElementById("engineStatus");
const captureCountChip = document.getElementById("captureCount");
const resetCounterButton = document.getElementById("resetCounter");
const openOptionsButton = document.getElementById("openOptions");

let engineEnabled = true;
let captureCount = 0;

document.addEventListener("DOMContentLoaded", async () => {
  const state = await chrome.storage.local.get([
    STORAGE_KEYS.ENGINE_ENABLED,
    STORAGE_KEYS.CAPTURE_COUNT,
  ]);

  engineEnabled = state[STORAGE_KEYS.ENGINE_ENABLED] !== false;
  captureCount = normalizeCaptureCount(state[STORAGE_KEYS.CAPTURE_COUNT]);
  render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.ENGINE_ENABLED]) {
    engineEnabled = changes[STORAGE_KEYS.ENGINE_ENABLED].newValue !== false;
    renderEngineStatus();
  }

  if (changes[STORAGE_KEYS.CAPTURE_COUNT]) {
    captureCount = normalizeCaptureCount(
      changes[STORAGE_KEYS.CAPTURE_COUNT].newValue,
    );
    renderCaptureCount();
  }
});

engineToggle.addEventListener("click", async () => {
  engineEnabled = !engineEnabled;
  render();

  await chrome.storage.local.set({
    [STORAGE_KEYS.ENGINE_ENABLED]: engineEnabled,
  });

  await chrome.runtime.sendMessage({
    type: "SET_ENGINE_ENABLED",
    enabled: engineEnabled,
  });
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

resetCounterButton.addEventListener("click", async () => {
  resetCounterButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "RESET_CAPTURE_COUNT",
    });

    if (response?.ok) {
      captureCount = normalizeCaptureCount(response.count);
    } else {
      throw new Error(response?.error || "Unknown reset error.");
    }
  } catch (error) {
    console.error("Failed to reset captured calls counter:", error);
  } finally {
    renderCaptureCount();
    resetCounterButton.disabled = captureCount === 0;
  }
});

function render() {
  renderEngineStatus();
  renderCaptureCount();
}

function renderEngineStatus() {
  engineToggle.setAttribute("aria-checked", String(engineEnabled));

  if (engineEnabled) {
    engineToggle.classList.remove("bg-gray-400");
    engineToggle.classList.add("bg-blue-600");
    engineThumb.classList.remove("translate-x-1");
    engineThumb.classList.add("translate-x-7");
    engineStatus.textContent = "Mocking is currently enabled.";
  } else {
    engineToggle.classList.remove("bg-blue-600");
    engineToggle.classList.add("bg-gray-400");
    engineThumb.classList.remove("translate-x-7");
    engineThumb.classList.add("translate-x-1");
    engineStatus.textContent = "Mocking is currently disabled.";
  }
}

function renderCaptureCount() {
  captureCountChip.textContent = String(captureCount);
  resetCounterButton.disabled = captureCount === 0;

  if (captureCount === 0) {
    resetCounterButton.classList.add("opacity-60", "cursor-not-allowed");
  } else {
    resetCounterButton.classList.remove("opacity-60", "cursor-not-allowed");
  }
}

function normalizeCaptureCount(value) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }

  return 0;
}
