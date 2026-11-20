import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb } = await distImport("store/db.js");
const { journalHead } = await distImport("sync/journal.js");
const { bindSource } = await distImport("sync/cloud-prepare.js");

const NOW = Date.UTC(2026, 10, 20);

function connection(overrides = {}) {
  return {
    version: 1, instanceId: randomUUID(), origin: "https://skillar.sh", accountId: "account-a",
    deviceId: "device-a", generation: 1, token: "T".repeat(43),
    expiresAt: Math.floor(NOW / 1000) + 3600, ...overrides,
  };
}
function meta(db, key) {
  return db.prepare("SELECT value FROM meta WHERE key=?").get(key)?.value;
}
function domains(path) {
  const db = openDb(path);
  try {
    return {
      source: journalHead(db).sourceDomain,
      clock: db.prepare("SELECT domain FROM recording_clock WHERE singleton=1").get().domain,
      instance: meta(db, "cloud.binding"), device: meta(db, "cloud.device"),
    };
  } finally {
    db.close();
  }
}

test("reconnecting the same device keeps the source domain and rebinds the instance", t => {
  // Given a store bound to one connection of a device.
  const home = makeTempDir(), path = join(home, "source.sqlite");
  t.after(() => removeDir(home));
  const first = connection();
  bindSource(path, first);
  const before = domains(path);
  // When the device reconnects with a new instance (scope upgrade, token renewal).
  const second = connection({ deviceId: first.deviceId, generation: first.generation });
  bindSource(path, second);
  // Then the source is kept and only the instance binding moves.
  const after = domains(path);
  assert.equal(after.source, before.source);
  assert.equal(after.clock, before.clock);
  assert.equal(after.instance, second.instanceId);
  assert.equal(after.device, `${first.deviceId}:${first.generation}`);
});

test("rebinding the same connection is a no-op", t => {
  // Given a bound store.
  const home = makeTempDir(), path = join(home, "source.sqlite");
  t.after(() => removeDir(home));
  const conn = connection();
  bindSource(path, conn);
  const before = domains(path);
  // When the identical connection binds again.
  bindSource(path, conn);
  // Then nothing changes.
  assert.deepEqual(domains(path), before);
});

test("a legacy install without a device marker adopts the device without forking", t => {
  // Given a store bound before device markers existed.
  const home = makeTempDir(), path = join(home, "source.sqlite");
  t.after(() => removeDir(home));
  const first = connection();
  bindSource(path, first);
  {
    const db = openDb(path);
    db.prepare("DELETE FROM meta WHERE key='cloud.device'").run();
    db.close();
  }
  const before = domains(path);
  assert.equal(before.device, undefined);
  // When a scope upgrade reconnects the same device with a new instance.
  const second = connection({ deviceId: first.deviceId, generation: first.generation });
  bindSource(path, second);
  // Then the source is kept and the device marker is adopted.
  const after = domains(path);
  assert.equal(after.source, before.source);
  assert.equal(after.instance, second.instanceId);
  assert.equal(after.device, `${first.deviceId}:${first.generation}`);
});

test("binding a different device forks the source with one shared new domain", t => {
  // Given a store bound to a device.
  const home = makeTempDir(), path = join(home, "source.sqlite");
  t.after(() => removeDir(home));
  bindSource(path, connection());
  const before = domains(path);
  // When a different device binds the store.
  const other = connection({ deviceId: "device-b" });
  bindSource(path, other);
  // Then the source forks, and the clock and sync identity share the new domain.
  const after = domains(path);
  assert.notEqual(after.source, before.source);
  assert.equal(after.clock, after.source);
  assert.equal(after.instance, other.instanceId);
  assert.equal(after.device, `device-b:1`);
});

test("a pending outbox still blocks a device change", t => {
  // Given a bound store with an unacked batch in the outbox.
  const home = makeTempDir(), path = join(home, "source.sqlite");
  t.after(() => removeDir(home));
  const first = connection();
  bindSource(path, first);
  {
    const db = openDb(path);
    db.prepare(`INSERT INTO sync_streams(stream_id,source_domain,device_id,next_sequence)
      VALUES('stream-a',?,'device-a',2)`).run(journalHead(db).sourceDomain);
    db.prepare(`INSERT INTO sync_outbox(stream_id,sequence,batch_id,payload,
        payload_hash,payload_bytes,journal_from,journal_through)
      VALUES('stream-a',1,?,'{}','h',2,0,0)`).run(randomUUID());
    db.close();
  }
  // When a different device tries to bind, the identity change is refused.
  assert.throws(() => bindSource(path, connection({ deviceId: "device-b" })),
    /pending_identity_change/);
  // And a plain reconnect of the same device is not blocked by the pending outbox.
  const second = connection({ deviceId: first.deviceId, generation: first.generation });
  bindSource(path, second);
  assert.equal(domains(path).instance, second.instanceId);
});
