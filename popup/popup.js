const STORAGE_KEYS = {
  ENGINE_ENABLED: "engineEnabled",
};

const engineToggle = document.getElementById("engineToggle");
const engineThumb = document.getElementById("engineThumb");
const engineStatus = document.getElementById("engineStatus");
const openOptionsButton = document.getElementById("openOptions");

let engineEnabled = true;

document.addEventListener("DOMContentLoaded", async () => {
  const state = await chrome.storage.local.get(STORAGE_KEYS.ENGINE_ENABLED);
  engineEnabled = state[STORAGE_KEYS.ENGINE_ENABLED] !== false;
  render();
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

function render() {
  engineToggle.setAttribute("aria-checked", String(engineEnabled));

  if (engineEnabled) {
    engineToggle.classList.remove("bg-slate-300");
    engineToggle.classList.add("bg-blue-600");
    engineThumb.classList.remove("translate-x-1");
    engineThumb.classList.add("translate-x-7");
    engineStatus.textContent = "Mocking is currently enabled.";
  } else {
    engineToggle.classList.remove("bg-blue-600");
    engineToggle.classList.add("bg-slate-300");
    engineThumb.classList.remove("translate-x-7");
    engineThumb.classList.add("translate-x-1");
    engineStatus.textContent = "Mocking is currently disabled.";
  }
}
