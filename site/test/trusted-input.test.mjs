import assert from "node:assert/strict";
import test from "node:test";
import { createTrustedInput, HarnessError } from "./helpers/trusted-input.mjs";
import { navigate } from "./command-palette.browser.mjs";

function fixture({ focused = true, grows = true, trusted = true } = {}) {
  let binding, receive, count = 0;
  const calls = [];
  const page = {
    cdp: { on(_event, listener) { receive = listener; return () => { receive = null; }; } },
    async evaluate(_fn, name) { return name ? count : focused; },
    async _sendToTarget(method, parameters) {
      calls.push({ method, parameters });
      if (method === "Runtime.addBinding") binding = parameters.name;
      if (method === "Input.dispatchKeyEvent" && parameters.type === "keyDown") {
        if (grows) count++;
        receive({ name: binding, payload: JSON.stringify({ key: parameters.key, count, trusted }) });
      }
    },
  };
  return { page, calls, resetDocument: () => { count = 0; } };
}

test("trusted keys focus the tab and prove window delivery after every key", async () => {
  const { page, calls, resetDocument } = fixture();
  const input = await createTrustedInput(page);
  try {
    await input.press({ key: "ArrowDown" });
    resetDocument(); // A new document has a fresh window counter.
    await input.press({ key: "Enter" });
    assert.equal(input.delivered, 2);
    for (const key of ["ArrowDown", "Enter"]) {
      const index = calls.findIndex(call => call.method === "Input.dispatchKeyEvent" &&
        call.parameters.type === "keyDown" && call.parameters.key === key);
      assert.equal(calls[index - 3].method, "Page.bringToFront");
      assert.deepEqual(calls[index - 2], {
        method: "Emulation.setFocusEmulationEnabled", parameters: { enabled: true },
      });
      assert.deepEqual(calls[index - 1], {
        method: "Runtime.evaluate", parameters: { expression: "window.focus()", returnByValue: true },
      });
    }
  } finally { await input.dispose(); }
});

test("unfocused input is a harness error and sends no keyboard events", async () => {
  const { page, calls } = fixture({ focused: false });
  const input = await createTrustedInput(page);
  try {
    await assert.rejects(input.press({ key: "ArrowDown" }), {
      name: "HarnessError", message: /HARNESS ERROR: document.hasFocus/,
    });
    assert.equal(calls.some(call => call.method === "Input.dispatchKeyEvent"), false);
  } finally { await input.dispose(); }
});

for (const options of [{ grows: false }, { trusted: false }]) {
  test(`invalid window delivery is a harness error: ${JSON.stringify(options)}`, async () => {
    const { page } = fixture(options);
    const input = await createTrustedInput(page);
    try {
      await assert.rejects(input.press({ key: "ArrowDown" }), {
        name: "HarnessError", message: /HARNESS ERROR: window keydown counter/,
      });
    } finally { await input.dispose(); }
  });
}

test("undelivered Enter cannot race into a site navigation timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let subscribed, rejectActivation, unsubscribed = false;
  const subscription = new Promise(resolve => { subscribed = resolve; });
  const activation = new Promise((_resolve, reject) => { rejectActivation = reject; });
  const page = {
    evaluate: async () => "https://skillar.sh/dashboard/",
    _sendToTarget: async () => {},
    cdp: { on() { subscribed(); return () => { unsubscribed = true; }; } },
  };
  const result = navigate(page, "https://skillar.sh/skills/", () => activation);
  await subscription;
  t.mock.timers.tick(15000);
  rejectActivation(new HarnessError("window keydown counter did not increase after Enter"));
  await assert.rejects(result, { name: "HarnessError" });
  assert.equal(unsubscribed, true);
});
