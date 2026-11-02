// Account-scoped envelope encryption for managed content.
//
// Each account has a random AES-256-GCM data-encryption key (DEK). The DEK is
// wrapped (AES-256-GCM) under a versioned server KEK held in a Worker secret.
// The Worker can unwrap the DEK and read content, so this is NOT end-to-end
// encryption. Uses only WebCrypto; no Node APIs. Nothing here logs key material.

export const CRYPTO_SCHEMA_VERSION = 1;
export const KEY_ALGORITHM = "A256GCM";

const NONCE_BYTES = 12;
const KEY_ID_BYTES = 16;
const DEK_BYTES = 32;
const TAG_BYTES = 16;
const KEK_USAGES: KeyUsage[] = ["wrapKey", "unwrapKey"];

export type CryptoErrorCode =
  | "invalid_input" // caller supplied a malformed context/expectation/key/plaintext
  | "invalid_envelope" // stored record/envelope is not strictly well-formed
  | "unsupported_version" // record/envelope version or algorithm is not supported
  | "key_mismatch" // keyVersion / keyId disagree with the caller's expectation
  | "authentication_failed"; // AAD (account/generation/object/...), KEK or ciphertext did not verify

export class ManagedCryptoError extends Error {
  readonly code: CryptoErrorCode;
  constructor(code: CryptoErrorCode) {
    super(code); // message is the bare code on purpose: never embeds secrets or inputs
    this.name = "ManagedCryptoError";
    this.code = code;
  }
}

/** Versioned server KEK. `key` is an AES-GCM CryptoKey usable for wrapKey/unwrapKey. */
export type ServerKek = {
  readonly version: number;
  readonly key: CryptoKey;
};

/** Account DEK in memory. `keyId` is the random public id stored in records and bound into AAD. */
export type ManagedKey = {
  readonly keyId: string;
  readonly key: CryptoKey;
};

/** Serializable (JSON, base64url) wrapped DEK. */
export type WrappedAccountKey = {
  readonly version: 1;
  readonly algorithm: "A256GCM";
  readonly keyId: string;
  readonly keyVersion: number;
  readonly iv: string;
  readonly wrappedKey: string;
};

/** Identity of the account key the caller expects; never taken from the stored record. */
export type AccountKeyExpectation = {
  readonly accountId: string;
  readonly generation: number;
  readonly keyVersion: number;
};

export type ContentContext = {
  readonly accountId: string;
  readonly generation: number;
  readonly objectKey: string;
  readonly revision: number;
  readonly schemaVersion: number;
};

/** Serializable (JSON, base64url) encrypted content. Claims no identity; context comes from the caller. */
export type EncryptedContent = {
  readonly version: 1;
  readonly algorithm: "A256GCM";
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
};

const encoder = new TextEncoder();

function fail(code: CryptoErrorCode): never {
  throw new ManagedCryptoError(code);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict, canonical, unpadded base64url. */
function fromBase64Url(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    return fail("invalid_envelope");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  if (toBase64Url(out) !== value) return fail("invalid_envelope");
  return out;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function checkExpectation(expected: AccountKeyExpectation): void {
  if (!isNonEmptyString(expected.accountId) || !isNonNegativeInt(expected.generation) || !isNonNegativeInt(expected.keyVersion)) {
    fail("invalid_input");
  }
}

function checkContext(context: ContentContext): void {
  if (
    !isNonEmptyString(context.accountId) || !isNonEmptyString(context.objectKey) ||
    !isNonNegativeInt(context.generation) || !isNonNegativeInt(context.revision) ||
    !isNonNegativeInt(context.schemaVersion)
  ) {
    fail("invalid_input");
  }
}

function checkKek(kek: ServerKek): void {
  if (!isNonNegativeInt(kek.version) || kek.key.algorithm.name !== "AES-GCM") fail("invalid_input");
}

function checkManagedKey(key: ManagedKey): void {
  if (!isNonEmptyString(key.keyId) || key.key.algorithm.name !== "AES-GCM") fail("invalid_input");
}

// JSON arrays of fixed shape with a domain label: unambiguous, no delimiter injection.
function wrapAad(accountId: string, generation: number, keyVersion: number, keyId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(["skillar.dek-wrap.v1", accountId, generation, keyVersion, keyId]));
}

function contentAad(context: ContentContext, keyId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([
    "skillar.content.v1", context.accountId, context.generation, context.objectKey,
    context.revision, context.schemaVersion, keyId,
  ]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Import raw 32-byte KEK material (from a Worker secret) as a versioned ServerKek. */
export async function importServerKek(version: number, raw: Uint8Array<ArrayBuffer>): Promise<ServerKek> {
  if (!isNonNegativeInt(version) || raw.byteLength !== DEK_BYTES) fail("invalid_input");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, KEK_USAGES);
  return { version, key };
}

/**
 * Create a fresh random account DEK and wrap it under `kek`.
 * Returns the in-memory key and the serializable record to persist.
 * keyVersion is `kek.version`. Throws ManagedCryptoError("invalid_input").
 */
export async function createWrappedAccountKey(
  kek: ServerKek,
  identity: { readonly accountId: string; readonly generation: number },
): Promise<{ readonly managedKey: ManagedKey; readonly wrapped: WrappedAccountKey }> {
  checkKek(kek);
  checkExpectation({ ...identity, keyVersion: kek.version });
  const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: DEK_BYTES * 8 }, true, ["encrypt", "decrypt"]);
  const keyId = toBase64Url(randomBytes(KEY_ID_BYTES));
  const iv = randomBytes(NONCE_BYTES);
  const aad = wrapAad(identity.accountId, identity.generation, kek.version, keyId);
  const wrappedKey = new Uint8Array(await crypto.subtle.wrapKey("raw", dek, kek.key, { name: "AES-GCM", iv, additionalData: aad }));
  // Re-import non-extractable so the returned key cannot be exported by later code.
  const raw = await crypto.subtle.exportKey("raw", dek);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  new Uint8Array(raw).fill(0);
  return {
    managedKey: { keyId, key },
    wrapped: {
      version: CRYPTO_SCHEMA_VERSION, algorithm: KEY_ALGORITHM, keyId, keyVersion: kek.version,
      iv: toBase64Url(iv), wrappedKey: toBase64Url(wrappedKey),
    },
  };
}

function parseWrapped(value: unknown): WrappedAccountKey {
  if (!isRecord(value)) return fail("invalid_envelope");
  if (value["version"] !== CRYPTO_SCHEMA_VERSION || value["algorithm"] !== KEY_ALGORITHM) return fail("unsupported_version");
  const keyId = value["keyId"], keyVersion = value["keyVersion"];
  if (!hasExactKeys(value, ["version", "algorithm", "keyId", "keyVersion", "iv", "wrappedKey"]) ||
    !isNonEmptyString(keyId) || !isNonNegativeInt(keyVersion)) return fail("invalid_envelope");
  const iv = fromBase64Url(value["iv"]), wrappedKey = fromBase64Url(value["wrappedKey"]);
  if (iv.length !== NONCE_BYTES || wrappedKey.length !== DEK_BYTES + TAG_BYTES) return fail("invalid_envelope");
  return {
    version: CRYPTO_SCHEMA_VERSION, algorithm: KEY_ALGORITHM, keyId, keyVersion,
    iv: toBase64Url(iv), wrappedKey: toBase64Url(wrappedKey),
  };
}

/**
 * Unwrap a stored DEK. Account, generation and key version come from `expected`
 * (the caller's trusted view), never from the record. The record's keyVersion must
 * equal both `expected.keyVersion` and `kek.version`.
 * Errors: invalid_input, invalid_envelope, unsupported_version, key_mismatch, authentication_failed.
 */
export async function unwrapAccountKey(
  wrapped: unknown,
  kek: ServerKek,
  expected: AccountKeyExpectation,
): Promise<ManagedKey> {
  checkKek(kek);
  checkExpectation(expected);
  const record = parseWrapped(wrapped);
  if (record.keyVersion !== expected.keyVersion || kek.version !== expected.keyVersion) return fail("key_mismatch");
  const aad = wrapAad(expected.accountId, expected.generation, expected.keyVersion, record.keyId);
  try {
    const key = await crypto.subtle.unwrapKey(
      "raw", fromBase64Url(record.wrappedKey), kek.key, { name: "AES-GCM", iv: fromBase64Url(record.iv), additionalData: aad },
      "AES-GCM", false, ["encrypt", "decrypt"],
    );
    return { keyId: record.keyId, key };
  } catch {
    return fail("authentication_failed");
  }
}

/**
 * Encrypt bytes for one object revision with a fresh random 96-bit nonce.
 * AAD binds account/generation/objectKey/revision/schemaVersion/keyId.
 * Errors: invalid_input.
 */
export async function encryptContent(
  managedKey: ManagedKey,
  context: ContentContext,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<EncryptedContent> {
  checkManagedKey(managedKey);
  checkContext(context);
  if (!(plaintext instanceof Uint8Array)) fail("invalid_input");
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: contentAad(context, managedKey.keyId) }, managedKey.key, plaintext,
  ));
  return {
    version: CRYPTO_SCHEMA_VERSION, algorithm: KEY_ALGORITHM, keyId: managedKey.keyId,
    nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext),
  };
}

function parseContent(value: unknown): EncryptedContent {
  if (!isRecord(value)) return fail("invalid_envelope");
  if (value["version"] !== CRYPTO_SCHEMA_VERSION || value["algorithm"] !== KEY_ALGORITHM) return fail("unsupported_version");
  const keyId = value["keyId"];
  if (!hasExactKeys(value, ["version", "algorithm", "keyId", "nonce", "ciphertext"]) || !isNonEmptyString(keyId)) {
    return fail("invalid_envelope");
  }
  const nonce = fromBase64Url(value["nonce"]), ciphertext = fromBase64Url(value["ciphertext"]);
  if (nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) return fail("invalid_envelope");
  return {
    version: CRYPTO_SCHEMA_VERSION, algorithm: KEY_ALGORITHM, keyId,
    nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext),
  };
}

/**
 * Decrypt and verify content under the caller's expected context.
 * Errors: invalid_input, invalid_envelope, unsupported_version,
 * key_mismatch (envelope keyId != managedKey.keyId), authentication_failed
 * (wrong key/account/generation/object/revision/schema or modified bytes).
 */
export async function decryptContent(
  managedKey: ManagedKey,
  context: ContentContext,
  envelope: unknown,
): Promise<Uint8Array> {
  checkManagedKey(managedKey);
  checkContext(context);
  const parsed = parseContent(envelope);
  if (parsed.keyId !== managedKey.keyId) return fail("key_mismatch");
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parsed.nonce), additionalData: contentAad(context, managedKey.keyId) },
      managedKey.key, fromBase64Url(parsed.ciphertext),
    ));
  } catch {
    return fail("authentication_failed");
  }
}
