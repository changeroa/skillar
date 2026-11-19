import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDb } from './helpers/activity-db.mjs';
import { pkceChallenge, signCookie, SESSION_COOKIE } from '../lib/auth.ts';
import { activityRequest } from '../lib/activity-routes.ts';
import { browserPrincipalSchema } from '../lib/activity-auth.ts';
import {
  approvePendingCode, createPendingCode, pollPendingCode, readPendingCode, sweepPendingCodes,
} from '../lib/device-pending.ts';

const now = 1_800_000_000;
const origin = 'https://site.example.test';
async function fixture(t) {
  const clock = { t: now };
  t.mock.method(Date, 'now', () => clock.t * 1000);
  const { db, accounts } = await activityDb(t);
  const env = {
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    SESSION_KEY: 'test-session-key-at-least-32-characters', PUBLIC_ORIGIN: origin, ACCOUNTS: accounts,
  };
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('a', 'a@example.com', '', '', now, now);
  db.prepare('INSERT INTO accounts(account_id,user_sub) VALUES(?,?)').run('a', 'a');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('a'.repeat(43), 'a', now + 3600);
  const principal = browserPrincipalSchema.parse({
    kind: 'browser', accountId: 'a', sessionId: 'a'.repeat(43), deviceId: null,
    generation: 1, shardId: 'activity-00', issuer: origin, scopes: ['activity:read', 'device:manage'],
  });
  const issue = () => createPendingCode({ deviceLabel: '테스트 맥북', scopes: ['activity:ingest'] }, env);
  return { db, accounts, env, principal, issue, clock };
}
test('full flow: issue, poll pending, approve, one pickup, replay refused', async t => {
  // Given
  const f = await fixture(t);
  const issued = await f.issue();
  assert.match(issued.userCode, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  // When: before approval the poll reports pending
  const early = await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin);
  assert.equal(early.kind, 'pending');
  // And: the approval page summary is readable but carries no secrets
  const summary = await readPendingCode(issued.userCode, f.env);
  assert.deepEqual(summary, {
    deviceLabel: '테스트 맥북', scopes: ['activity:ingest'], upgrade: false, expiresAt: now + 600,
  });
  // And: approval binds the request to the approving account
  const approved = await approvePendingCode(f.principal, { code: issued.userCode }, f.env);
  assert.equal(approved.kind, 'approved');
  // Then: exactly one pickup succeeds (past the poll interval)
  f.clock.t += 6;
  const pickup = await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin);
  assert.equal(pickup.kind, 'issued');
  assert.equal(pickup.deviceId, approved.deviceId);
  // The grant is short-lived and single-use; the long-lived token comes from
  // the existing exchange boundary only.
  assert.equal(pickup.expiresAt, now + 6 + 600);
  f.clock.t += 6;
  const replay = await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin);
  assert.equal(replay.kind, 'consumed');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM device_grants').get().n, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM api_tokens').get().n, 0);
});

test('concurrent polls mint exactly one grant', async t => {
  // Given
  const f = await fixture(t);
  const issued = await f.issue();
  await approvePendingCode(f.principal, { code: issued.userCode }, f.env);
  // When
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    pollPendingCode({ pollToken: issued.pollToken }, f.env, origin)));
  // Then
  assert.equal(results.filter(r => r.kind === 'issued').length, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM device_grants').get().n, 1);
});

test('expired requests cannot be read, approved or polled', async t => {
  // Given
  const f = await fixture(t);
  const issued = await f.issue();
  f.db.prepare('UPDATE device_pending_codes SET expires_at=?').run(now - 1);
  // Then
  assert.equal(await readPendingCode(issued.userCode, f.env), null);
  assert.equal((await approvePendingCode(f.principal, { code: issued.userCode }, f.env)).kind, 'unknown');
  assert.equal((await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin)).kind, 'unknown');
});

test('only hashes are persisted for code, poll token and minted grant', async t => {
  // Given
  const f = await fixture(t);
  const issued = await f.issue();
  await approvePendingCode(f.principal, { code: issued.userCode }, f.env);
  const pickup = await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin);
  assert.equal(pickup.kind, 'issued');
  // Then
  const persisted = JSON.stringify([
    f.db.prepare('SELECT * FROM device_pending_codes').all(),
    f.db.prepare('SELECT * FROM device_grants').all(),
    f.db.prepare('SELECT * FROM api_tokens').all(),
  ]);
  assert.equal(persisted.includes(issued.userCode.replace('-', '')), false);
  assert.equal(persisted.includes(issued.pollToken), false);
  assert.equal(persisted.includes(pickup.grant), false);
  assert.equal(f.db.prepare('SELECT code_hash FROM device_pending_codes').get().code_hash,
    await pkceChallenge(issued.userCode.replace('-', '')));
});

test('approval with consent writes a server-built version 1 record in the same batch', async t => {
  // Given
  const f = await fixture(t);
  const issued = await f.issue();
  // When
  const approved = await approvePendingCode(f.principal, {
    code: issued.userCode, consent: { mode: 'metadata' },
  }, f.env);
  assert.equal(approved.kind, 'approved');
  // Then: the consent references the server-minted device id and its derived project id
  const consent = f.db.prepare('SELECT * FROM device_consents').get();
  assert.equal(consent.version, 1);
  assert.equal(consent.device_id, approved.deviceId);
  const record = JSON.parse(consent.consent_json);
  assert.equal(record.mode, 'metadata');
  assert.equal(record.scope.deviceId, approved.deviceId);
  assert.deepEqual(record.scope.projectIds, [`device:${approved.deviceId}`]);
  assert.equal(record.grantedAtMs, now * 1000);
});

test('an invalid consent choice rejects before any write or counter change', async t => {
  // Given: a managed-content choice with no content kinds, rejected by the choice schema
  const f = await fixture(t);
  const issued = await f.issue();
  // When
  await assert.rejects(() => approvePendingCode(f.principal, {
    code: issued.userCode,
    consent: { mode: 'managed-content', contentKinds: [], serverProcessingAcknowledged: true },
  }, f.env));
  // Then: no device, no binding, no consent, and no failed-attempt bump
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM devices').get().n, 0);
  assert.equal(f.db.prepare('SELECT failed_attempts FROM device_pending_codes').get().failed_attempts, 0);
  assert.equal(f.db.prepare('SELECT approved_at FROM device_pending_codes').get().approved_at, null);
});

test('concurrent approvals bind exactly one account and one device', async t => {
  // Given: two accounts racing to approve the same code
  const f = await fixture(t);
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('b', 'b@example.com', '', '', now, now);
  f.db.prepare('INSERT INTO accounts(account_id,user_sub) VALUES(?,?)').run('b', 'b');
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('b'.repeat(43), 'b', now + 3600);
  const other = browserPrincipalSchema.parse({
    kind: 'browser', accountId: 'b', sessionId: 'b'.repeat(43), deviceId: null,
    generation: 1, shardId: 'activity-00', issuer: origin, scopes: ['activity:read', 'device:manage'],
  });
  const issued = await f.issue();
  // When
  const outcomes = await Promise.all([
    approvePendingCode(f.principal, { code: issued.userCode }, f.env),
    approvePendingCode(other, { code: issued.userCode }, f.env),
  ]);
  // Then: one winner, no orphan device from the loser
  assert.equal(outcomes.filter(o => o.kind === 'approved').length, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM devices').get().n, 1);
});

test('poll interval throttles repeated polling', async t => {
  // Given
  const f = await fixture(t);
  const issued = await f.issue();
  // When
  assert.equal((await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin)).kind, 'pending');
  // Then: an immediate second poll is throttled
  assert.equal((await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin)).kind, 'throttled');
});

test('sweep removes terminal rows past retention and keeps fresh ones', async t => {
  // Given: one consumed row past 24h, one expired row past 24h, one fresh pending row
  const f = await fixture(t);
  const consumed = await f.issue();
  await approvePendingCode(f.principal, { code: consumed.userCode }, f.env);
  await pollPendingCode({ pollToken: consumed.pollToken }, f.env, origin);
  const expired = await f.issue();
  const fresh = await f.issue();
  f.db.prepare('UPDATE device_pending_codes SET consumed_at=? WHERE poll_hash=?')
    .run(now - 90000, await pkceChallenge(consumed.pollToken));
  f.db.prepare('UPDATE device_pending_codes SET expires_at=? WHERE poll_hash=?')
    .run(now - 90000, await pkceChallenge(expired.pollToken));
  // When
  await sweepPendingCodes(f.accounts, now);
  // Then
  const remaining = f.db.prepare('SELECT count(*) AS n FROM device_pending_codes').get().n;
  assert.equal(remaining, 1);
  assert.equal(await readPendingCode(fresh.userCode, f.env) !== null, true);
});

test('approve attempts are limited per account per minute', async t => {
  // Given: 10 approve attempts from the account in the same minute
  const f = await fixture(t);
  const issued = await f.issue();
  for (let i = 0; i < 10; i++) {
    await approvePendingCode(f.principal, { code: 'XXXX-XXXX' }, f.env, '10.0.0.1');
  }
  // Then: the 11th is limited and the real code was not consumed by the limited call
  assert.equal((await approvePendingCode(f.principal, { code: issued.userCode }, f.env, '10.0.0.2')).kind, 'limited');
  assert.equal(f.db.prepare('SELECT approved_at FROM device_pending_codes').get().approved_at, null);
});

test('approve attempts are limited per IP across accounts', async t => {
  // Given: 60 approve attempts from one IP spread over six accounts (10 each)
  const f = await fixture(t);
  const principals = [f.principal];
  for (const suffix of 'bcdefg') {
    f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(suffix, `${suffix}@example.com`, '', '', now, now);
    f.db.prepare('INSERT INTO accounts(account_id,user_sub) VALUES(?,?)').run(suffix, suffix);
    f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(suffix.repeat(43), suffix, now + 3600);
    principals.push(browserPrincipalSchema.parse({
      kind: 'browser', accountId: suffix, sessionId: suffix.repeat(43), deviceId: null,
      generation: 1, shardId: 'activity-00', issuer: origin, scopes: ['activity:read', 'device:manage'],
    }));
  }
  for (const principal of principals) {
    for (let i = 0; i < 10; i++) {
      await approvePendingCode(principal, { code: 'XXXX-XXXX' }, f.env, '10.9.9.9');
    }
  }
  // Then: the 61st attempt from that IP is limited even from a fresh account
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('h', 'h@example.com', '', '', now, now);
  f.db.prepare('INSERT INTO accounts(account_id,user_sub) VALUES(?,?)').run('h', 'h');
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('h'.repeat(43), 'h', now + 3600);
  const fresh = browserPrincipalSchema.parse({
    kind: 'browser', accountId: 'h', sessionId: 'h'.repeat(43), deviceId: null,
    generation: 1, shardId: 'activity-00', issuer: origin, scopes: ['activity:read', 'device:manage'],
  });
  assert.equal((await approvePendingCode(fresh, { code: 'XXXX-XXXX' }, f.env, '10.9.9.9')).kind, 'limited');
  // And: the same account from another IP is not limited
  assert.equal((await approvePendingCode(fresh, { code: 'XXXX-XXXX' }, f.env, '10.9.9.10')).kind, 'unknown');
});

test('sweep removes attempt counters older than one hour', async t => {
  // Given
  const f = await fixture(t);
  f.db.prepare('INSERT INTO device_pending_attempts VALUES(?,?,1)').run('acct:a', now - 7200);
  f.db.prepare('INSERT INTO device_pending_attempts VALUES(?,?,1)').run('acct:b', now - 60);
  // When
  await sweepPendingCodes(f.accounts, now);
  // Then
  assert.deepEqual(f.db.prepare('SELECT subject FROM device_pending_attempts').all().map(r => r.subject), ['acct:b']);
});

test('approval binds the approving account, not the requesting CLI', async t => {
  // Given: a second account approves the code
  const f = await fixture(t);
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('b', 'b@example.com', '', '', now, now);
  f.db.prepare('INSERT INTO accounts(account_id,user_sub) VALUES(?,?)').run('b', 'b');
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('b'.repeat(43), 'b', now + 3600);
  const other = browserPrincipalSchema.parse({
    kind: 'browser', accountId: 'b', sessionId: 'b'.repeat(43), deviceId: null,
    generation: 1, shardId: 'activity-00', issuer: origin, scopes: ['activity:read', 'device:manage'],
  });
  const issued = await f.issue();
  // When
  const approved = await approvePendingCode(other, { code: issued.userCode }, f.env);
  // Then
  assert.equal(approved.kind, 'approved');
  const row = f.db.prepare('SELECT account_id FROM devices').get();
  assert.equal(row.account_id, 'b');
});

test('summary API exposes the expiry as epoch milliseconds (expiresAtMs), never seconds', async t => {
  // Given an issued request (store keeps epoch seconds)
  const f = await fixture(t);
  const issued = await f.issue();
  const routeEnv = { ...f.env, ACTIVITY_ENABLED: 'true' };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: 'a', sid: 'a'.repeat(43) }, 'session', routeEnv, now)}`;
  // When the approval page reads the summary through the HTTP route
  const res = await activityRequest(new Request(
    `${origin}/api/devices/pending/${encodeURIComponent(issued.userCode)}`, { headers: { cookie } }), routeEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  // Then the expiry is epoch ms matching the stored seconds, and no raw-seconds field leaks
  assert.equal(body.expiresAtMs, (now + 600) * 1000);
  assert.equal('expiresAt' in body, false);
});

test('publish approval: skills scopes issue and approve like activity scopes', async t => {
  // Given: a pending code asking for the private-skill pair
  const f = await fixture(t);
  const issued = await createPendingCode(
    { deviceLabel: '테스트 맥북', scopes: ['skills:read', 'skills:write'] }, f.env);
  // When
  const summary = await readPendingCode(issued.userCode, f.env);
  assert.deepEqual(summary?.scopes, ['skills:read', 'skills:write']);
  assert.equal(summary?.upgrade, false);
  const approved = await approvePendingCode(f.principal, { code: issued.userCode }, f.env);
  assert.equal(approved.kind, 'approved');
  f.clock.t += 6;
  const pickup = await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin);
  // Then: the grant carries exactly the skills scopes
  assert.equal(pickup.kind, 'issued');
  const grantRow = f.db.prepare('SELECT scopes_json AS s FROM device_grants').get();
  assert.deepEqual(JSON.parse(grantRow.s), ['skills:read', 'skills:write']);
});

test('scope upgrade: approval reuses the named device and refuses consent', async t => {
  // Given: an already-connected device on this account
  const f = await fixture(t);
  const deviceId = 'd'.repeat(43);
  f.db.prepare('INSERT INTO devices(account_id,device_id,created_at) VALUES(?,?,?)')
    .run('a', deviceId, now);
  // And: a pending code that names that device for a scope upgrade
  const issued = await createPendingCode(
    { deviceLabel: '테스트 맥북', scopes: ['activity:read', 'activity:ingest', 'skills:read', 'skills:write'],
      deviceId }, f.env);
  const summary = await readPendingCode(issued.userCode, f.env);
  assert.equal(summary?.upgrade, true);
  // When: an upload-consent submission is a client error, not an attempt
  await assert.rejects(
    approvePendingCode(f.principal, { code: issued.userCode, consent: { mode: 'metadata' } }, f.env),
    /consent_not_allowed/);
  // And: approval adds scopes to the same device instead of minting a new one
  const approved = await approvePendingCode(f.principal, { code: issued.userCode }, f.env);
  assert.deepEqual(approved, { kind: 'approved', deviceId });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM devices').get().n, 1);
  f.clock.t += 6;
  const pickup = await pollPendingCode({ pollToken: issued.pollToken }, f.env, origin);
  assert.equal(pickup.kind, 'issued');
  assert.equal(pickup.deviceId, deviceId);
  const grantRow = f.db.prepare('SELECT scopes_json AS s FROM device_grants').get();
  assert.deepEqual(JSON.parse(grantRow.s),
    ['activity:read', 'activity:ingest', 'skills:read', 'skills:write']);
});

test('scope upgrade: a device id owned by another account is unapprovable', async t => {
  // Given: someone else's device named in the pending code
  const f = await fixture(t);
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('b', 'b@example.com', '', '', now, now);
  f.db.prepare('INSERT INTO accounts(account_id,user_sub) VALUES(?,?)').run('b', 'b');
  f.db.prepare('INSERT INTO devices(account_id,device_id,created_at) VALUES(?,?,?)')
    .run('b', 'e'.repeat(43), now);
  const issued = await createPendingCode(
    { deviceLabel: '테스트 맥북', scopes: ['skills:read'], deviceId: 'e'.repeat(43) }, f.env);
  // When / Then: the device guard fails and the request stays approvable by nobody
  const outcome = await approvePendingCode(f.principal, { code: issued.userCode }, f.env);
  assert.equal(outcome.kind, 'conflict');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM device_grants').get().n, 0);
});
