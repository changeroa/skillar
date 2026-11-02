import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

// Runs the real src/activity/crypto.ts, bundled, inside workerd. The tiny entry
// below only maps JSON requests to the module's named exports.
const entry = `
import { createWrappedAccountKey, unwrapAccountKey, encryptContent, decryptContent, importServerKek, ManagedCryptoError } from "./crypto.ts";
const b64 = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const keks = new Map(), keys = new Map();
let next = 0;
const handle = key => { const id = "k" + next++; keys.set(id, key); return id; };
const ops = {
  async kek({ id, version, raw }) { keks.set(id, await importServerKek(version, unb64(raw))); return {}; },
  async create({ kek, identity }) {
    const { managedKey, wrapped } = await createWrappedAccountKey(keks.get(kek), identity);
    return { handle: handle(managedKey), keyId: managedKey.keyId, wrapped };
  },
  async unwrap({ kek, wrapped, expected }) {
    const key = await unwrapAccountKey(wrapped, keks.get(kek), expected);
    return { handle: handle(key), keyId: key.keyId };
  },
  async encrypt({ handle, context, plaintext }) { return await encryptContent(keys.get(handle), context, unb64(plaintext)); },
  async decrypt({ handle, context, envelope }) { return { plaintext: b64(await decryptContent(keys.get(handle), context, envelope)) }; },
  async exportable({ handle }) {
    try { await crypto.subtle.exportKey("raw", keys.get(handle).key); return { exportable: true }; }
    catch { return { exportable: false }; }
  },
};
export default {
  async fetch(request) {
    const { op, args } = await request.json();
    try { return Response.json({ ok: await ops[op](args) }); }
    catch (error) {
      if (error instanceof ManagedCryptoError) return Response.json({ error: error.code, message: error.message });
      throw error;
    }
  },
};
`;

const bundle = build({
  stdin: { contents: entry, resolveDir: fileURLToPath(new URL("../src/activity/", import.meta.url)), sourcefile: "crypto-entry.ts", loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});

const b64 = bytes => Buffer.from(bytes).toString("base64url");
const unb64 = text => new Uint8Array(Buffer.from(text, "base64url"));

async function fixture(t) {
  const contents = (await bundle).outputFiles[0].text;
  const runtime = new Miniflare({ telemetry: { enabled: false }, logRequests: false, workers: [{ config: {
    type: "worker", name: "crypto-test", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } }, exports: {},
  } }] });
  t.after(() => runtime.dispose());
  const url = await runtime.ready;
  const call = async (op, args) => {
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ op, args }) });
    assert.equal(response.status, 200);
    return await response.json();
  };
  const ok = async (op, args) => {
    const result = await call(op, args);
    assert.ok("ok" in result, `${op} failed: ${JSON.stringify(result)}`);
    return result.ok;
  };
  const rejects = async (op, args, code) => {
    const result = await call(op, args);
    assert.deepEqual({ error: result.error, message: result.message }, { error: code, message: code });
  };
  let kekCount = 0;
  const kek = async (version = 1, raw = crypto.getRandomValues(new Uint8Array(32))) => {
    const id = `kek${kekCount++}`;
    await ok("kek", { id, version, raw: b64(raw) });
    return id;
  };
  return { call, ok, rejects, kek };
}

const identity = { accountId: "acct-a", generation: 3 };
const expected = { ...identity, keyVersion: 1 };
const context = { accountId: "acct-a", generation: 3, objectKey: "content/obj-1", revision: 7, schemaVersion: 2 };
const encrypt = (f, handle, plaintext, ctx = context) => f.ok("encrypt", { handle, context: ctx, plaintext: b64(plaintext) });
const decrypt = (f, handle, envelope, ctx = context) => f.ok("decrypt", { handle, context: ctx, envelope });
const decryptFails = (f, handle, envelope, code, ctx = context) => f.rejects("decrypt", { handle, context: ctx, envelope }, code);

async function account(f, id = identity, kekId, version = 1) {
  const k = kekId ?? await f.kek(version);
  const created = await f.ok("create", { kek: k, identity: id });
  return { k, ...created };
}

function flip(text) {
  const bytes = unb64(text);
  bytes[bytes.length >> 1] ^= 1;
  return b64(bytes);
}

test("wrapped key record is serializable base64url and unwraps to a working non-extractable key", async t => {
  const f = await fixture(t);
  const a = await account(f);
  assert.deepEqual(Object.keys(a.wrapped).sort(), ["algorithm", "iv", "keyId", "keyVersion", "version", "wrappedKey"]);
  assert.equal(a.wrapped.version, 1);
  assert.equal(a.wrapped.algorithm, "A256GCM");
  assert.equal(a.wrapped.keyVersion, 1);
  assert.equal(a.wrapped.keyId, a.keyId);
  assert.equal(unb64(a.wrapped.iv).length, 12);
  assert.equal(unb64(a.wrapped.wrappedKey).length, 48);
  for (const field of ["iv", "wrappedKey", "keyId"]) assert.match(a.wrapped[field], /^[A-Za-z0-9_-]+$/);
  assert.equal((await f.ok("exportable", { handle: a.handle })).exportable, false);

  const stored = JSON.parse(JSON.stringify(a.wrapped));
  const unwrapped = await f.ok("unwrap", { kek: a.k, wrapped: stored, expected });
  assert.equal(unwrapped.keyId, a.keyId);
  assert.equal((await f.ok("exportable", { handle: unwrapped.handle })).exportable, false);
  const sealed = await encrypt(f, a.handle, new TextEncoder().encode("hello"));
  assert.equal(b64(unb64((await decrypt(f, unwrapped.handle, sealed)).plaintext)), b64(new TextEncoder().encode("hello")));
});

test("each created account key is independent", async t => {
  const f = await fixture(t);
  const k = await f.kek();
  const one = await account(f, identity, k), two = await account(f, identity, k);
  assert.notEqual(one.keyId, two.keyId);
  assert.notEqual(one.wrapped.wrappedKey, two.wrapped.wrappedKey);
  assert.notEqual(one.wrapped.iv, two.wrapped.iv);
  const sealed = await encrypt(f, one.handle, new Uint8Array([1, 2, 3]));
  await decryptFails(f, two.handle, sealed, "key_mismatch");
  await decryptFails(f, two.handle, { ...sealed, keyId: two.keyId }, "authentication_failed");
});

test("binary bytes roundtrip losslessly including empty, all byte values and 1 MiB", async t => {
  const f = await fixture(t);
  const a = await account(f);
  const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const big = new Uint8Array(1024 * 1024);
  for (let offset = 0; offset < big.length; offset += 65536) crypto.getRandomValues(big.subarray(offset, offset + 65536));
  for (const bytes of [new Uint8Array(0), new Uint8Array([0]), allBytes, new Uint8Array([0xff, 0xfe, 0, 0x80]), big]) {
    const sealed = await encrypt(f, a.handle, bytes);
    assert.equal(unb64(sealed.ciphertext).length, bytes.length + 16);
    const opened = await decrypt(f, a.handle, sealed);
    assert.ok(Buffer.from(unb64(opened.plaintext)).equals(Buffer.from(bytes)));
  }
});

test("Unicode text roundtrips byte-for-byte and context strings are bound exactly", async t => {
  const f = await fixture(t);
  const a = await account(f, { accountId: "계정-é-\u{1F510}", generation: 0 });
  const text = "한국어 e\u0301 \u00e9 \u{1F680} \u0000 line\r\nbreak \ud7ff";
  const bytes = new TextEncoder().encode(text);
  const ctx = { accountId: "계정-é-\u{1F510}", generation: 0, objectKey: "활동/é/\u{1F4C1}.json", revision: 0, schemaVersion: 1 };
  const sealed = await encrypt(f, a.handle, bytes, ctx);
  const opened = await decrypt(f, a.handle, sealed, ctx);
  assert.equal(new TextDecoder().decode(unb64(opened.plaintext)), text);
  await decryptFails(f, a.handle, sealed, "authentication_failed", { ...ctx, objectKey: "활동/e\u0301/\u{1F4C1}.json" });
});

test("object nonces are random, unique and 96 bits; ciphertext differs for identical plaintext", async t => {
  const f = await fixture(t);
  const a = await account(f);
  const seen = new Set(), texts = new Set();
  for (let i = 0; i < 200; i += 1) {
    const sealed = await encrypt(f, a.handle, new Uint8Array([9, 9, 9]));
    assert.equal(unb64(sealed.nonce).length, 12);
    seen.add(sealed.nonce);
    texts.add(sealed.ciphertext);
  }
  assert.equal(seen.size, 200);
  assert.equal(texts.size, 200);
});

test("every AAD field is authenticated for content", async t => {
  const f = await fixture(t);
  const a = await account(f);
  const sealed = await encrypt(f, a.handle, new TextEncoder().encode("secret"));
  for (const change of [
    { accountId: "acct-b" }, { generation: 4 }, { objectKey: "content/obj-2" }, { revision: 8 }, { schemaVersion: 3 },
  ]) await decryptFails(f, a.handle, sealed, "authentication_failed", { ...context, ...change });
  await decrypt(f, a.handle, sealed);
});

test("modified ciphertext, nonce or key id is rejected", async t => {
  const f = await fixture(t);
  const a = await account(f);
  const sealed = await encrypt(f, a.handle, new TextEncoder().encode("secret"));
  await decryptFails(f, a.handle, { ...sealed, ciphertext: flip(sealed.ciphertext) }, "authentication_failed");
  await decryptFails(f, a.handle, { ...sealed, nonce: flip(sealed.nonce) }, "authentication_failed");
  await decryptFails(f, a.handle, { ...sealed, ciphertext: b64(unb64(sealed.ciphertext).slice(0, -3)) }, "authentication_failed");
  await decryptFails(f, a.handle, { ...sealed, keyId: "other-key" }, "key_mismatch");
  const other = await account(f);
  await decryptFails(f, other.handle, sealed, "key_mismatch");
});

test("cross-tenant: another account's key, record or claimed identity never opens data", async t => {
  const f = await fixture(t);
  const k = await f.kek();
  const a = await account(f, identity, k);
  const b = await account(f, { accountId: "acct-b", generation: 3 }, k);
  const sealed = await encrypt(f, a.handle, new TextEncoder().encode("tenant a"));
  await decryptFails(f, b.handle, sealed, "key_mismatch");
  await decryptFails(f, b.handle, { ...sealed, keyId: b.keyId }, "authentication_failed");
  await f.rejects("unwrap", { kek: k, wrapped: a.wrapped, expected: { ...expected, accountId: "acct-b" } }, "authentication_failed");
  await f.rejects("unwrap", { kek: k, wrapped: b.wrapped, expected }, "authentication_failed");
  await f.rejects("unwrap", { kek: k, wrapped: { ...a.wrapped, accountId: "acct-b" }, expected }, "invalid_envelope");
  await f.ok("unwrap", { kek: k, wrapped: a.wrapped, expected });
});

test("DEK wrap binds generation, key version and keyId", async t => {
  const f = await fixture(t);
  const k = await f.kek();
  const a = await account(f, identity, k);
  await f.rejects("unwrap", { kek: k, wrapped: a.wrapped, expected: { ...expected, generation: 4 } }, "authentication_failed");
  await f.rejects("unwrap", { kek: k, wrapped: { ...a.wrapped, keyId: "swapped" }, expected }, "authentication_failed");
  await f.rejects("unwrap", { kek: k, wrapped: { ...a.wrapped, wrappedKey: flip(a.wrapped.wrappedKey) }, expected }, "authentication_failed");
  await f.rejects("unwrap", { kek: k, wrapped: { ...a.wrapped, iv: flip(a.wrapped.iv) }, expected }, "authentication_failed");
});

test("wrong KEK material and wrong or stale KEK/key versions are rejected", async t => {
  const f = await fixture(t);
  const v1 = await f.kek(1);
  const a = await account(f, identity, v1);
  const sameVersionOtherSecret = await f.kek(1);
  await f.rejects("unwrap", { kek: sameVersionOtherSecret, wrapped: a.wrapped, expected }, "authentication_failed");
  const v2 = await f.kek(2);
  await f.rejects("unwrap", { kek: v2, wrapped: a.wrapped, expected }, "key_mismatch");
  await f.rejects("unwrap", { kek: v2, wrapped: a.wrapped, expected: { ...expected, keyVersion: 2 } }, "key_mismatch");
  await f.rejects("unwrap", { kek: v1, wrapped: a.wrapped, expected: { ...expected, keyVersion: 2 } }, "key_mismatch");
  const created = await f.ok("create", { kek: v2, identity });
  assert.equal(created.wrapped.keyVersion, 2);
  await f.ok("unwrap", { kek: v2, wrapped: created.wrapped, expected: { ...expected, keyVersion: 2 } });
  await f.rejects("unwrap", { kek: v1, wrapped: { ...created.wrapped, keyVersion: 1 }, expected }, "authentication_failed");
});

test("unsupported versions and algorithms are rejected before decryption", async t => {
  const f = await fixture(t);
  const a = await account(f);
  const sealed = await encrypt(f, a.handle, new Uint8Array([1]));
  for (const version of [0, 2, "1", null]) {
    await f.rejects("unwrap", { kek: a.k, wrapped: { ...a.wrapped, version }, expected }, "unsupported_version");
    await decryptFails(f, a.handle, { ...sealed, version }, "unsupported_version");
  }
  await f.rejects("unwrap", { kek: a.k, wrapped: { ...a.wrapped, algorithm: "A128GCM" }, expected }, "unsupported_version");
  await decryptFails(f, a.handle, { ...sealed, algorithm: "A128GCM" }, "unsupported_version");
});

test("strict schema parsing rejects unknown, missing, mistyped and non-canonical fields", async t => {
  const f = await fixture(t);
  const a = await account(f);
  const sealed = await encrypt(f, a.handle, new Uint8Array([1, 2]));
  const { nonce: _nonce, ...withoutNonce } = sealed;
  for (const bad of [
    null, "text", [], 7, { ...sealed, extra: 1 }, withoutNonce, { ...sealed, nonce: 5 }, { ...sealed, keyId: "" },
    { ...sealed, nonce: `${sealed.nonce}=` }, { ...sealed, nonce: "AAAA" }, { ...sealed, ciphertext: "a" },
    { ...sealed, ciphertext: "!!!!" }, { ...sealed, ciphertext: "AAAA" }, { ...sealed, ciphertext: sealed.ciphertext.replace(/[-_]/g, "+") + "+" },
  ]) await decryptFails(f, a.handle, bad, "invalid_envelope");
  const { wrappedKey: _wrapped, ...withoutWrapped } = a.wrapped;
  for (const bad of [
    null, [], { ...a.wrapped, extra: true }, withoutWrapped, { ...a.wrapped, keyVersion: 1.5 }, { ...a.wrapped, keyVersion: -1 },
    { ...a.wrapped, iv: "AAAA" }, { ...a.wrapped, wrappedKey: "AAAA" }, { ...a.wrapped, keyId: 1 },
  ]) await f.rejects("unwrap", { kek: a.k, wrapped: bad, expected }, "invalid_envelope");
});

test("malformed caller inputs and KEK material fail with invalid_input", async t => {
  const f = await fixture(t);
  const a = await account(f);
  const sealed = await encrypt(f, a.handle, new Uint8Array([1]));
  for (const change of [
    { accountId: "" }, { objectKey: "" }, { generation: -1 }, { generation: 1.5 }, { revision: Number.NaN }, { schemaVersion: "1" },
  ]) {
    await f.rejects("encrypt", { handle: a.handle, context: { ...context, ...change }, plaintext: "AA" }, "invalid_input");
    await decryptFails(f, a.handle, sealed, "invalid_input", { ...context, ...change });
  }
  await f.rejects("unwrap", { kek: a.k, wrapped: a.wrapped, expected: { ...expected, accountId: "" } }, "invalid_input");
  await f.rejects("create", { kek: a.k, identity: { accountId: "acct", generation: -1 } }, "invalid_input");
  await f.rejects("kek", { id: "short", version: 1, raw: b64(new Uint8Array(16)) }, "invalid_input");
  await f.rejects("kek", { id: "neg", version: -1, raw: b64(new Uint8Array(32)) }, "invalid_input");
});

test("errors carry only the bare code and never echo plaintext, keys or identifiers", async t => {
  const f = await fixture(t);
  const a = await account(f);
  const secret = "very-secret-plaintext";
  const sealed = await encrypt(f, a.handle, new TextEncoder().encode(secret));
  const failure = await f.call("decrypt", { handle: a.handle, context: { ...context, revision: 99 }, envelope: sealed });
  assert.deepEqual(failure, { error: "authentication_failed", message: "authentication_failed" });
  assert.ok(!JSON.stringify(sealed).includes(secret));
});
