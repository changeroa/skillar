import { z } from "zod";
import {
  createWrappedAccountKey, importServerKek, unwrapAccountKey,
} from "./crypto.ts";
import type { ManagedKey, ServerKek } from "./crypto.ts";

type Account = { readonly accountId: string; readonly generation: number };
export class ContentStorageError extends Error {
  constructor(
    readonly code: "key_unavailable" | "content_missing" | "content_conflict" | "content_expired",
    readonly status: 409 | 503,
  ) {
    super(code);
    this.name = "ContentStorageError";
  }
}
const keyringSchema = z.strictObject({
  current: z.number().int().positive(),
  keys: z.record(z.string(), z.string().regex(/^[A-Za-z0-9_-]{43}$/)),
});

function keyring(secret: string) {
  let value: unknown;
  try {
    value = JSON.parse(secret);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ContentStorageError("key_unavailable", 503);
    throw error;
  }
  const parsed = keyringSchema.safeParse(value);
  if (!parsed.success || parsed.data.keys[String(parsed.data.current)] === undefined) {
    throw new ContentStorageError("key_unavailable", 503);
  }
  return parsed.data;
}

async function serverKey(secret: string, version: number): Promise<ServerKek> {
  const material = keyring(secret).keys[String(version)];
  if (material === undefined) throw new ContentStorageError("key_unavailable", 503);
  const binary = atob(material.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  try {
    return await importServerKek(version, bytes);
  } finally {
    bytes.fill(0);
  }
}

/** Reads never create a replacement for a missing historical key. */
export async function readContentKey(
  db: D1Database, account: Account, secret: string, version: number,
): Promise<ManagedKey> {
  const row = await db.prepare(`SELECT wrapped_key_json FROM account_content_keys
    WHERE account_id=? AND generation=? AND key_version=?`)
    .bind(account.accountId, account.generation, String(version)).first();
  if (row === null) throw new ContentStorageError("key_unavailable", 503);
  const saved = z.object({ wrapped_key_json: z.string() }).parse(row);
  return unwrapAccountKey(JSON.parse(saved.wrapped_key_json), await serverKey(secret, version), {
    ...account, keyVersion: version,
  });
}

/** A version change affects new writes; old KEKs must stay until retained reads expire. */
export async function writeContentKey(
  db: D1Database, account: Account, secret: string,
): Promise<{ readonly key: ManagedKey; readonly version: number }> {
  const version = keyring(secret).current;
  const existing = await db.prepare(`SELECT 1 FROM account_content_keys
    WHERE account_id=? AND generation=? AND key_version=?`)
    .bind(account.accountId, account.generation, String(version)).first();
  if (existing === null) {
    const created = await createWrappedAccountKey(await serverKey(secret, version), account);
    await db.prepare(`INSERT INTO account_content_keys
      (account_id,generation,key_version,wrapped_key_json) VALUES (?,?,?,?)
      ON CONFLICT(account_id,generation,key_version) DO NOTHING`)
      .bind(account.accountId, account.generation, String(version),
        JSON.stringify(created.wrapped)).run();
  }
  // Concurrent first writers must both use the row that actually won insertion.
  return { key: await readContentKey(db, account, secret, version), version };
}
