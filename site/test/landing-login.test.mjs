import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/account.ts", import.meta.url))],
  bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
  nodePaths: [fileURLToPath(new URL("../node_modules", import.meta.url))],
});
const source = bundle.outputFiles[0].text;
const user = { sub: "fixture", email: "fixture@example.test", name: "예시 계정", picture: "", createdAt: 1800000000, lastLogin: 1800000000 };

function page(t, { login = false, search = "" } = {}) {
  const response = Promise.withResolvers();
  const settled = Promise.withResolvers();
  const requested = Promise.withResolvers();
  const elements = new Map();
  for (const id of login
    ? ["session-status", "auth-result", "auth-recovery", "signed-in", "signed-out", "account-title"]
    : ["landing-actions", "landing-session-status", "landing-primary", "landing-secondary"]) {
    elements.set(`#${id}`, { hidden: id === "signed-in" || id === "auth-recovery" || id === "landing-actions", textContent: "", href: "" });
  }
  if (!login) {
    elements.get("#landing-primary").href = "/login/";
    elements.get("#landing-secondary").href = "#example";
    const actions = elements.get("#landing-actions");
    Object.defineProperty(actions, "hidden", {
      get: () => !actions.ready,
      set(value) { actions.ready = !value; if (!value) settled.resolve(); },
    });
  } else {
    const status = elements.get("#session-status");
    Object.defineProperty(status, "textContent", {
      get: () => status.value ?? "",
      set(value) { status.value = value; if (value !== "계정 확인 중…") settled.resolve(); },
    });
  }
  const timeout = setTimeout(() => settled.reject(new Error("Session state did not settle")), 5000);
  t.after(() => clearTimeout(timeout));
  const document = {
    querySelector: selector => elements.get(selector) ?? null,
    querySelectorAll: () => [],
    title: "",
  };
  runInNewContext(source, {
    document, window: { location: { search } },
    Request: class extends Request {
      constructor(input, options) { super(typeof input === "string" ? new URL(input, "https://skillar.test") : input, options); }
    },
    Response, Headers, AbortController, AbortSignal, URL, URLSearchParams,
    setTimeout, clearTimeout, TextEncoder, TextDecoder, FormData, Blob, DOMException,
    fetch: async request => { requested.resolve(request); return response.promise; },
  });
  return { elements, document, response, settled: settled.promise, requested: requested.promise };
}

test("landing keeps neutral actions while the existing no-store session read is pending", async t => {
  // Given / When
  const fixture = page(t);
  const request = await fixture.requested;
  // Then
  assert.equal(request.url, "https://skillar.test/auth/session");
  assert.equal(request.method, "GET");
  assert.equal(request.cache, "no-store");
  assert.equal(request.credentials, "same-origin");
  assert.equal(fixture.elements.get("#landing-actions").hidden, true);
  fixture.response.resolve(Response.json({ user: null }));
  await fixture.settled;
});

for (const signedIn of [false, true]) {
  test(`landing resolves ${signedIn ? "signed-in" : "anonymous"} destinations from the session`, async t => {
    // Given
    const fixture = page(t);
    await fixture.requested;
    // When
    fixture.response.resolve(Response.json({ user: signedIn ? user : null }));
    await fixture.settled;
    // Then
    assert.equal(fixture.elements.get("#landing-primary").href, signedIn ? "/dashboard/" : "/login/");
    assert.equal(fixture.elements.get("#landing-secondary").href, signedIn ? "/skills/" : "#example");
    assert.equal(fixture.elements.get("#landing-actions").hidden, false);
  });
}

test("an invalid session response cannot expose signed-in landing destinations", async t => {
  // Given
  const fixture = page(t);
  await fixture.requested;
  // When
  fixture.response.resolve(Response.json({ user: { email: user.email } }));
  await fixture.settled;
  // Then
  assert.equal(fixture.elements.get("#landing-primary").href, "/login/");
  assert.equal(fixture.elements.get("#landing-secondary").href, "#example");
  assert.ok(fixture.elements.get("#landing-session-status").textContent);
});

test("callback errors expose recovery without reflecting the query value", async t => {
  // Given / When
  const fixture = page(t, { login: true, search: "?error=%3Cscript%3E" });
  // Then
  assert.equal(fixture.elements.get("#auth-recovery").hidden, false);
  assert.ok(fixture.elements.get("#auth-result").textContent);
  assert.ok(!fixture.elements.get("#auth-result").textContent.includes("<script>"));
  fixture.response.resolve(Response.json({ user: null }));
  await fixture.settled;
});

test("signed-in login shows the account title and hides anonymous recovery", async t => {
  // Given
  const fixture = page(t, { login: true, search: "?error=cancelled" });
  await fixture.requested;
  // When
  fixture.response.resolve(Response.json({ user }));
  await fixture.settled;
  // Then
  assert.equal(fixture.elements.get("#signed-out").hidden, true);
  assert.equal(fixture.elements.get("#signed-in").hidden, false);
  assert.equal(fixture.elements.get("#auth-recovery").hidden, true);
  assert.equal(fixture.elements.get("#account-title").textContent, "계정");
});
