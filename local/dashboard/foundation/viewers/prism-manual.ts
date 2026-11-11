// Prism is a tokenizer only. Disable its DOM/innerHTML auto-highlighter before it loads.
Object.defineProperty(globalThis, "Prism", { value: { manual: true }, writable: true, configurable: true });
