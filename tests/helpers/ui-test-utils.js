const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createEventChannel() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    async emit(...args) {
      for (const listener of listeners) {
        await listener(...args);
      }
    },
  };
}

function createClassList() {
  const classes = new Set();

  return {
    add(...tokens) {
      for (const token of tokens) {
        classes.add(token);
      }
    },
    remove(...tokens) {
      for (const token of tokens) {
        classes.delete(token);
      }
    },
    contains(token) {
      return classes.has(token);
    },
    toArray() {
      return [...classes];
    },
  };
}

function createElement(id) {
  const eventListeners = new Map();
  const attributes = new Map();

  const element = {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    dataset: {},
    classList: createClassList(),
    addEventListener(eventName, handler) {
      const handlers = eventListeners.get(eventName) || [];
      handlers.push(handler);
      eventListeners.set(eventName, handlers);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    focus() {},
    reset() {
      element.value = "";
    },
    closest(selector) {
      if (selector === "button[data-action]" && element.dataset?.action) {
        return element;
      }

      return null;
    },
    async trigger(eventName, eventData = {}) {
      const handlers = eventListeners.get(eventName) || [];
      for (const handler of handlers) {
        await handler({ target: element, ...eventData });
      }
    },
  };

  return element;
}

function createDocumentMock(elementIds) {
  const elements = {};
  const listeners = new Map();

  for (const id of elementIds) {
    elements[id] = createElement(id);
  }

  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
    addEventListener(eventName, handler) {
      const handlers = listeners.get(eventName) || [];
      handlers.push(handler);
      listeners.set(eventName, handlers);
    },
    async emit(eventName) {
      const handlers = listeners.get(eventName) || [];
      for (const handler of handlers) {
        await handler();
      }
    },
  };

  return { document, elements };
}

function createStorageArea(store, onChanged) {
  function normalizeGet(keys) {
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
      return normalizeGet(keys);
    },
    async set(nextValues) {
      const changes = {};
      for (const [key, newValue] of Object.entries(nextValues)) {
        const oldValue = store[key];
        store[key] = newValue;
        changes[key] = { oldValue, newValue };
      }
      await onChanged.emit(changes, "local");
    },
  };
}

function createChromeMock({
  initialStore = {},
  sendMessageResponse = {},
} = {}) {
  const store = { ...initialStore };
  const onChanged = createEventChannel();
  const sentMessages = [];
  let openOptionsPageCalls = 0;

  const chrome = {
    storage: {
      onChanged,
      local: createStorageArea(store, onChanged),
    },
    runtime: {
      async sendMessage(message) {
        sentMessages.push(message);
        if (typeof sendMessageResponse === "function") {
          return sendMessageResponse(message);
        }
        return sendMessageResponse;
      },
      openOptionsPage() {
        openOptionsPageCalls += 1;
      },
    },
  };

  return {
    chrome,
    store,
    sentMessages,
    getOpenOptionsPageCalls() {
      return openOptionsPageCalls;
    },
    onChanged,
  };
}

function loadScriptInVm({ scriptPath, contextValues }) {
  const code = fs.readFileSync(scriptPath, "utf8");
  const context = {
    ...contextValues,
    console,
    Date,
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
    RegExp,
    crypto: {
      randomUUID() {
        return "test-uuid";
      },
    },
    confirm() {
      return true;
    },
  };

  vm.createContext(context);
  vm.runInContext(code, context, { filename: path.basename(scriptPath) });
  return context;
}

module.exports = {
  createDocumentMock,
  createChromeMock,
  loadScriptInVm,
};
