import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDb } from './helpers/activity-db.mjs';
import { AuthenticationError, pkceChallenge } from '../lib/auth.ts';
import { browserPrincipalSchema, sourceNamespace } from '../lib/activity-auth.ts';
import {
  issueDeviceGrant, exchangeDeviceGrant, readDevicePrincipal, revokeDevice,
} from '../lib/device-auth.ts';

const now = 1_800_000_000;
const origin = 'https://skillar-site.pages.dev';
async function fixture(t) {
  t.mock.method(Date, 'now', () => now * 1000);
  const { db, accounts } = await activityDb(t);
  const env = {
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    SESSION_KEY: 'test-session-key-at-least-32-characters', PUBLIC_ORIGIN: origin, ACCOUNTS: accounts,
  };
  const browser = id => {
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id, `${id}@example.com`, '', '', now, now);
    db.prepare('INSERT INTO accounts(account_id,user_sub) VALUES(?,?)').run(id, id);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(id.repeat(43), id, now + 3600);
    return browserPrincipalSchema.parse({
      kind: 'browser', accountId: id, sessionId: id.repeat(43), deviceId: null,
      generation: 1, shardId: 'activity-00', issuer: origin, scopes: ['activity:read', 'device:manage'],
    });
  };
  const principal = browser('a');
  const request = (token, headers = {}, host = origin) => new Request(`${host}/api/activity`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, ...headers },
  });
  const grant = () => issueDeviceGrant(principal, ['activity:ingest'], env);
  const credential = async () => {
    const issued = await grant();
    const exchanged = await exchangeDeviceGrant(issued.grant, env, origin);
    assert.ok(exchanged);
    return exchanged;
  };
  return { db, accounts, env, browser, principal, request, grant, credential };
}

test('concurrent exchanges mint one token and replay cannot mint another', async t => {
  // Given
  const f = await fixture(t);
  const issued = await f.grant();
  // When
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    exchangeDeviceGrant(issued.grant, f.env, origin)));
  const replay = await exchangeDeviceGrant(issued.grant, f.env, origin);
  // Then
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(replay, null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM api_tokens').get().n, 1);
  assert.equal(f.db.prepare('SELECT consumed_at FROM device_grants').get().consumed_at, now);
  assert.equal(issued.expiresAt, now + 600);
  const winner = results.find(Boolean);
  assert.equal(winner.expiresAt, now + 30 * 86400);
  assert.equal(winner.deviceId, issued.deviceId);
});

test('persists only hashes and reconstructs a restricted device principal', async t => {
  // Given
  const f = await fixture(t);
  const issued = await f.grant();
  const exchanged = await exchangeDeviceGrant(issued.grant, f.env, origin);
  assert.ok(exchanged);
  // When
  const principal = await readDevicePrincipal(f.request(exchanged.token), f.env);
  // Then
  assert.deepEqual(principal, {
    kind: 'device', accountId: 'a', sessionId: null, deviceId: issued.deviceId,
    issuer: origin, generation: 1, shardId: 'activity-00', scopes: ['activity:ingest'],
  });
  const persisted = JSON.stringify([
    f.db.prepare('SELECT * FROM device_grants').all(), f.db.prepare('SELECT * FROM api_tokens').all(),
  ]);
  assert.equal(persisted.includes(issued.grant), false);
  assert.equal(persisted.includes(exchanged.token), false);
  assert.equal(f.db.prepare('SELECT grant_hash FROM device_grants').get().grant_hash,
    await pkceChallenge(issued.grant));
  assert.equal(f.db.prepare('SELECT token_hash FROM api_tokens').get().token_hash,
    await pkceChallenge(exchanged.token));
});

const invalidGrant = [
  ['expiry', 'UPDATE device_grants SET expires_at=?', now],
  ['audience', 'UPDATE device_grants SET audience=?', 'other'],
  ['issuer', 'UPDATE device_grants SET issuer=?', 'https://skillar.sh'],
  ['device revocation', 'UPDATE devices SET revoked_at=?', now],
  ['generation', 'UPDATE accounts SET auth_generation=?', 2],
  ['account revocation', 'UPDATE accounts SET state=?', 'revoked'],
  ['session expiry', 'UPDATE sessions SET expires_at=?', now],
  ['management scope', 'UPDATE device_grants SET scopes_json=?', '["device:manage"]'],
  ['malformed scopes', 'UPDATE device_grants SET scopes_json=?', '{'],
  ['empty scopes', 'UPDATE device_grants SET scopes_json=?', '[]'],
  ['logout', 'DELETE FROM sessions WHERE id=?', 'a'.repeat(43)],
];
for (const [name, sql, value] of invalidGrant) {
  test(`exchange rejects ${name} without creating a token`, async t => {
    // Given
    const f = await fixture(t);
    const issued = await f.grant();
    f.db.prepare(sql).run(value);
    // When
    const result = await exchangeDeviceGrant(issued.grant, f.env, origin);
    // Then
    assert.equal(result, null);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM api_tokens').get().n, 0);
  });
}

for (const [name, sql, value] of [
  ['expiry', 'UPDATE api_tokens SET expires_at=?', now],
  ['token revocation', 'UPDATE api_tokens SET revoked_at=?', now],
  ['device revocation', 'UPDATE devices SET revoked_at=?', now],
  ['generation', 'UPDATE accounts SET auth_generation=?', 2],
  ['account revocation', 'UPDATE accounts SET state=?', 'revoked'],
  ['issuer', 'UPDATE api_tokens SET issuer=?', 'https://skillar.sh'],
  ['audience', 'UPDATE api_tokens SET audience=?', 'other'],
  ['management scope', 'UPDATE api_tokens SET scopes_json=?', '["activity:read","device:manage"]'],
  ['invalid JSON', 'UPDATE api_tokens SET scopes_json=?', '{'],
  ['invalid scope', 'UPDATE api_tokens SET scopes_json=?', '["unknown"]'],
  ['empty scopes', 'UPDATE api_tokens SET scopes_json=?', '[]'],
]) {
  test(`bearer read rejects ${name} immediately after a successful read`, async t => {
    // Given
    const f = await fixture(t);
    const token = await f.credential();
    assert.ok(await readDevicePrincipal(f.request(token.token), f.env));
    f.db.prepare(sql).run(value);
    // When / Then
    assert.equal(await readDevicePrincipal(f.request(token.token), f.env), null);
  });
}

test('bearer origins must match an approved host but CLI requests need no Origin', async t => {
  // Given
  const f = await fixture(t);
  const token = await f.credential();
  // When / Then
  assert.ok(await readDevicePrincipal(f.request(token.token), f.env));
  assert.ok(await readDevicePrincipal(f.request(token.token, { origin }), f.env));
  assert.equal(await readDevicePrincipal(f.request(token.token, { origin: 'https://evil.example' }), f.env), null);
  assert.equal(await readDevicePrincipal(f.request(token.token, {}, 'https://evil.example'), f.env), null);
  assert.equal(await exchangeDeviceGrant((await f.grant()).grant, f.env, 'https://skillar.sh'), null);
});

for (const [name, mutation] of [
  ['logout', db => db.prepare('DELETE FROM sessions').run()],
  ['generation', db => db.prepare('UPDATE accounts SET auth_generation=2').run()],
  ['account revocation', db => db.prepare("UPDATE accounts SET state='revoked'").run()],
  ['session expiry', db => db.prepare('UPDATE sessions SET expires_at=?').run(now)],
]) {
  test(`issue checks ${name} at the final SQL writes`, async t => {
    // Given
    const f = await fixture(t);
    const accounts = { ...f.accounts, batch: queries => {
      mutation(f.db);
      return f.accounts.batch(queries);
    } };
    // When / Then
    await assert.rejects(issueDeviceGrant(f.principal, ['activity:read'], {
      ...f.env, ACCOUNTS: accounts,
    }), AuthenticationError);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM devices').get().n, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM device_grants').get().n, 0);
  });
}

test('device and non-management browser principals cannot manage credentials', async t => {
  // Given
  const f = await fixture(t);
  const token = await f.credential();
  const device = await readDevicePrincipal(f.request(token.token), f.env);
  // When / Then
  for (const principal of [device, { ...f.principal, scopes: ['activity:read'] }]) {
    await assert.rejects(issueDeviceGrant(principal, ['activity:read'], f.env), AuthenticationError);
    await assert.rejects(revokeDevice(principal, token.deviceId, f.env), AuthenticationError);
  }
  await assert.rejects(issueDeviceGrant(f.principal, ['device:manage'], f.env));
});

test('revocation is tenant scoped even with identical device and source IDs', async t => {
  // Given
  const f = await fixture(t);
  const other = f.browser('b');
  const token = await f.credential();
  f.db.prepare('INSERT INTO devices VALUES(?,?,?,NULL)').run('b', token.deviceId, now);
  f.db.prepare(`INSERT INTO api_tokens SELECT ?, 'b', device_id, scopes_json, issuer,
    audience, auth_generation, expires_at, NULL FROM api_tokens`).run(await pkceChallenge('b'.repeat(43)));
  const source = { deviceId: token.deviceId, sourceDomain: 'codex', sourceId: 'same' };
  const namespaces = await Promise.all([f.principal, other].map(p => sourceNamespace(p, source, f.accounts)));
  // When
  const revoked = await revokeDevice(f.principal, token.deviceId, f.env);
  // Then
  assert.equal(revoked, true);
  assert.notEqual(namespaces[0], namespaces[1]);
  assert.equal(await readDevicePrincipal(f.request(token.token), f.env), null);
  assert.ok(await readDevicePrincipal(f.request('b'.repeat(43)), f.env));
  assert.equal(f.db.prepare("SELECT revoked_at FROM api_tokens WHERE account_id='a'").get().revoked_at, now);
  assert.equal(f.db.prepare("SELECT revoked_at FROM devices WHERE account_id='b'").get().revoked_at, null);
});

test('revocation rechecks the session at its final tenant update', async t => {
  // Given
  const f = await fixture(t);
  const token = await f.credential();
  f.db.prepare('DELETE FROM sessions').run();
  // When
  const result = await revokeDevice(f.principal, token.deviceId, f.env);
  // Then
  assert.equal(result, false);
  assert.ok(await readDevicePrincipal(f.request(token.token), f.env));
});

test('D1 adapter supports RETURNING, first columns, all, and atomic rollback', async t => {
  // Given
  const { db, accounts } = await fixture(t);
  // When
  const returned = await accounts.prepare('UPDATE accounts SET auth_generation=2 RETURNING account_id').all();
  await assert.rejects(accounts.batch([
    accounts.prepare('UPDATE accounts SET auth_generation=3'),
    accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES('duplicate','a')"),
  ]));
  // Then
  assert.equal(returned.meta.changes, 1);
  assert.equal(returned.results[0].account_id, 'a');
  assert.equal(await accounts.prepare('SELECT auth_generation FROM accounts').first('auth_generation'), 2);
  assert.equal(db.prepare('SELECT auth_generation FROM accounts').get().auth_generation, 2);
});

test('read-only grants stay read-only after exchange', async t => {
  // Given
  const f = await fixture(t);
  const grant = await issueDeviceGrant(f.principal, ['activity:read'], f.env);
  // When
  const token = await exchangeDeviceGrant(grant.grant, f.env, origin);
  // Then
  assert.ok(token);
  assert.deepEqual((await readDevicePrincipal(f.request(token.token), f.env)).scopes, ['activity:read']);
});

for (const operation of ['exchange', 'revoke']) {
  test(`${operation} rolls back its first write when the second write fails`, async t => {
    // Given
    const f = await fixture(t);
    const grant = await f.grant();
    const token = operation === 'revoke' ? await exchangeDeviceGrant(grant.grant, f.env, origin) : null;
    const table = operation === 'exchange' ? 'device_grants' : 'api_tokens';
    f.db.exec(`CREATE TRIGGER reject_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'transaction failure'); END`);
    // When / Then
    await assert.rejects(operation === 'exchange'
      ? exchangeDeviceGrant(grant.grant, f.env, origin)
      : revokeDevice(f.principal, grant.deviceId, f.env), /transaction failure/);
    assert.equal(f.db.prepare('SELECT consumed_at FROM device_grants').get().consumed_at,
      operation === 'exchange' ? null : now);
    assert.equal(f.db.prepare('SELECT revoked_at FROM devices').get().revoked_at, null);
    if (token) assert.ok(await readDevicePrincipal(f.request(token.token), f.env));
    else assert.equal(f.db.prepare('SELECT count(*) AS n FROM api_tokens').get().n, 0);
  });
}
