import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  AuthenticationError, cookie, FLOW_COOKIE, FLOW_SECONDS, pkceChallenge, randomToken,
  readFlow, readSession, SESSION_COOKIE, SESSION_SECONDS, signCookie, verifyGoogleToken,
} from '../lib/auth.ts';
import { onRequest } from '../functions/auth/[[path]].ts';

const now = 1_800_000_000;
const origin = 'https://site.example.test';
const config = {
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  SESSION_KEY: 'test-session-key-at-least-32-characters',
  PUBLIC_ORIGIN: origin,
};
const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJwk = { ...await exportJWK(publicKey), kid: 'test-google-key', alg: 'RS256', use: 'sig' };
const keys = createLocalJWKSet({ keys: [publicJwk] });
const profile = {
  sub: 'google-user-123', email: 'person@example.com', email_verified: true,
  name: 'Test Person', picture: 'https://example.com/avatar.png', nonce: 'expected-nonce',
};

async function idToken(overrides = {}, key = privateKey) {
  return new SignJWT({ ...profile, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-google-key' })
    .setIssuer(overrides.iss ?? 'https://accounts.google.com')
    .setAudience(overrides.aud ?? config.GOOGLE_CLIENT_ID)
    .setIssuedAt(overrides.iat ?? now)
    .setExpirationTime(overrides.exp ?? now + 3600)
    .sign(key);
}

test('verifies a genuine Google-shaped signature and returns only the allowed profile fields', async () => {
  // Given
  const token = await idToken();
  // When
  const user = await verifyGoogleToken(token, config.GOOGLE_CLIENT_ID, profile.nonce, now, keys);
  // Then
  assert.deepEqual(user, {
    sub: profile.sub, email: profile.email, name: profile.name, picture: profile.picture,
  });
});

for (const [name, overrides] of [
  ['issuer', { iss: 'https://attacker.example' }],
  ['audience', { aud: 'another-client' }],
  ['expiry', { exp: now }],
  ['nonce', { nonce: 'wrong' }],
  ['missing nonce', { nonce: undefined }],
  ['missing subject', { sub: undefined }],
  ['unverified email', { email_verified: false }],
  ['invalid profile email', { email: 'not-an-email' }],
  ['unsafe picture', { picture: 'javascript:alert(1)' }],
  ['authorized party', { azp: 'another-client' }],
  ['multiple audiences without authorized party', { aud: [config.GOOGLE_CLIENT_ID, 'other-client'] }],
]) {
  test(`rejects an ID token with invalid ${name}`, async () => {
    // Given
    const token = await idToken(overrides);
    // When / Then
    await assert.rejects(
      verifyGoogleToken(token, config.GOOGLE_CLIENT_ID, profile.nonce, now, keys),
      AuthenticationError,
    );
  });
}

test('rejects an ID token signed by a different private key', async () => {
  // Given
  const attacker = await generateKeyPair('RS256');
  const token = await idToken({}, attacker.privateKey);
  // When / Then
  await assert.rejects(
    verifyGoogleToken(token, config.GOOGLE_CLIENT_ID, profile.nonce, now, keys),
    AuthenticationError,
  );
});

test('rejects an unsigned ID token', async () => {
  // Given
  const token = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(profile)).toString('base64url')}.`;
  // When / Then
  await assert.rejects(
    verifyGoogleToken(token, config.GOOGLE_CLIENT_ID, profile.nonce, now, keys),
    AuthenticationError,
  );
});

test('derives the RFC 7636 S256 PKCE challenge', async () => {
  // Given
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  // When
  const challenge = await pkceChallenge(verifier);
  // Then
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('sets host-only secure HttpOnly lax cookies with bounded lifetime', () => {
  // Given / When
  const value = cookie(SESSION_COOKIE, 'signed-token', SESSION_SECONDS);
  // Then
  assert.equal(value, '__Host-skillar_session=signed-token; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800');
  assert.equal(cookie(SESSION_COOKIE, '', 0).endsWith('Max-Age=0'), true);
});

const flow = { state: 's'.repeat(43), nonce: 'n'.repeat(43), verifier: 'v'.repeat(43) };
function callbackRequest(token, state = flow.state) {
  return new Request(`${origin}/auth/google/callback?state=${state}&code=test-code`, {
    headers: token ? { cookie: `${FLOW_COOKIE}=${token}` } : {},
  });
}

test('accepts state only when it matches the signed browser flow cookie', async () => {
  // Given
  const token = await signCookie(flow, 'oauth', config, now);
  // When
  const result = await readFlow(callbackRequest(token), config, now);
  // Then
  assert.deepEqual(result, flow);
});

for (const condition of ['missing', 'mismatched', 'tampered', 'expired', 'wrong purpose']) {
  test(`rejects ${condition} OAuth state`, async () => {
    // Given
    const token = await signCookie(flow, condition === 'wrong purpose' ? 'session' : 'oauth', config, now);
    const request = callbackRequest(
      condition === 'missing' ? undefined : condition === 'tampered' ? `${token.slice(0, -8)}corrupt!` : token,
      condition === 'mismatched' ? 'different-state' : flow.state,
    );
    // When / Then
    await assert.rejects(
      readFlow(request, config, condition === 'expired' ? now + FLOW_SECONDS : now),
      AuthenticationError,
    );
  });
}

test('reads signed session claims without placing the profile in the cookie', async () => {
  // Given
  const session = { sub: profile.sub, sid: 'r'.repeat(43) };
  const token = await signCookie(session, 'session', config, now);
  const request = new Request(`${origin}/auth/session`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  // When
  const result = await readSession(request, config, now);
  // Then
  assert.deepEqual(result, session);
  assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).email, undefined);
});

test('treats an expired session as signed out', async () => {
  // Given
  const token = await signCookie({ sub: profile.sub, sid: randomToken() }, 'session', config, now);
  const request = new Request(`${origin}/auth/session`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  // When
  const result = await readSession(request, config, now + SESSION_SECONDS);
  // Then
  assert.equal(result, null);
});

test('treats a forged session as signed out', async () => {
  // Given
  const token = await signCookie({ sub: profile.sub, sid: randomToken() }, 'session', {
    ...config, SESSION_KEY: 'a-different-signing-key-with-32-characters',
  }, now);
  const request = new Request(`${origin}/auth/session`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  // When
  const result = await readSession(request, config, now);
  // Then
  assert.equal(result, null);
});

// The adapter uses real SQLite for the D1 SQL contract, not canned query results.
async function fixture(t) {
  t.mock.method(Date, 'now', () => now * 1000);
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
  });
  const env = { ...config, ACCOUNTS: {
    prepare: statement,
    batch: async queries => {
      db.exec('BEGIN');
      try {
        const result = [];
        for (const query of queries) result.push(await query.run());
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } };
  const request = (path, init = {}) => onRequest({ request: new Request(origin + path, init), env });
  const outbound = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const req = new Request(input, init);
    outbound.push(req.url);
    if (req.url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [publicJwk] });
    if (req.url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(await req.text());
      assert.equal(body.get('client_secret'), config.GOOGLE_CLIENT_SECRET);
      assert.equal(body.get('redirect_uri'), `${origin}/auth/google/callback`);
      assert.equal(body.get('code_verifier'), flow.verifier);
      return Response.json({ id_token: await idToken({
        nonce: flow.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
      }) });
    }
    throw new Error(`Unexpected outbound host: ${new URL(req.url).hostname}`);
  });
  const login = async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signedFlow = await signCookie(flow, 'oauth', config, timestamp);
    return request(`/auth/google/callback?state=${flow.state}&code=google-code`, {
      headers: { cookie: `${FLOW_COOKIE}=${signedFlow}` },
    });
  };
  return { request, login, db, env, outbound };
}

test('authorization starts with minimal scopes, unique state and nonce, and S256 PKCE', async t => {
  // Given
  const f = await fixture(t);
  // When
  const response = await f.request('/auth/google');
  // Then
  assert.equal(response.status, 303);
  const url = new URL(response.headers.get('location'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), `${origin}/auth/google/callback`);
  const cookieValue = response.headers.getSetCookie()[0].split(';')[0].slice(FLOW_COOKIE.length + 1);
  const signedFlow = await readFlow(callbackRequest(cookieValue, url.searchParams.get('state')), config, Math.floor(Date.now() / 1000));
  assert.equal(url.searchParams.get('nonce'), signedFlow.nonce);
  assert.equal(url.searchParams.get('code_challenge'), await pkceChallenge(signedFlow.verifier));
  assert.notEqual(signedFlow.state, signedFlow.nonce);
  assert.deepEqual(f.outbound, []);
});

test('callback persists only the allowed profile and establishes a revocable signed session', async t => {
  // Given
  const f = await fixture(t);
  // When
  const response = await f.login();
  // Then
  assert.equal(response.headers.get('location'), '/login/');
  const user = f.db.prepare('SELECT * FROM users').get();
  assert.deepEqual(Object.keys(user).sort(), ['created_at', 'email', 'last_login', 'name', 'picture', 'sub']);
  assert.equal(user.sub, profile.sub);
  assert.equal(user.email, profile.email);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.some(value => value.startsWith(`${FLOW_COOKIE}=`) && value.endsWith('Max-Age=0')), true);
  assert.equal(cookies.some(value => value.startsWith(`${SESSION_COOKIE}=`) && value.includes('HttpOnly; Secure; SameSite=Lax')), true);
});

test('session API returns the persisted signed-in user without cacheable responses', async t => {
  // Given
  const f = await fixture(t);
  const login = await f.login();
  const signedCookie = login.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];
  // When
  const response = await f.request('/auth/session', { headers: { cookie: signedCookie } });
  // Then
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { user } = await response.json();
  assert.equal(user.email, profile.email);
  assert.equal(user.sub, profile.sub);
  assert.equal(user.createdAt, user.lastLogin);
});

test('a returning Google subject updates last login without creating another user', async t => {
  // Given
  const f = await fixture(t);
  await f.login();
  t.mock.method(Date, 'now', () => (now + 60) * 1000);
  // When
  const response = await f.login();
  // Then
  assert.equal(response.headers.get('location'), '/login/');
  const users = f.db.prepare('SELECT * FROM users').all();
  assert.equal(users.length, 1);
  assert.equal(users[0].created_at, now);
  assert.equal(users[0].last_login, now + 60);
});

test('an otherwise valid cookie without a stored session cannot authenticate', async t => {
  // Given
  const f = await fixture(t);
  const token = await signCookie({ sub: profile.sub, sid: randomToken() }, 'session', config, now);
  // When
  const response = await f.request('/auth/session', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  // Then
  assert.deepEqual(await response.json(), { user: null });
});

test('logout revokes the stored session and clears cookies', async t => {
  // Given
  const f = await fixture(t);
  const login = await f.login();
  const signedCookie = login.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];
  // When
  const response = await f.request('/auth/logout', {
    method: 'POST', headers: { origin, cookie: signedCookie },
  });
  // Then
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login/');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  assert.equal(response.headers.getSetCookie().every(value => value.endsWith('Max-Age=0')), true);
  assert.deepEqual(await (await f.request('/auth/session', { headers: { cookie: signedCookie } })).json(), { user: null });
});

for (const source of [undefined, 'https://attacker.example']) {
  test(`rejects logout with ${source ? 'a foreign' : 'no'} Origin before revoking a session`, async t => {
    // Given
    const f = await fixture(t);
    await f.login();
    // When
    const response = await f.request('/auth/logout', { method: 'POST', headers: source ? { origin: source } : {} });
    // Then
    assert.equal(response.status, 403);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  });
}

test('callback rejects invalid state before contacting Google or creating an account', async t => {
  // Given
  const f = await fixture(t);
  // When
  const response = await f.request('/auth/google/callback?state=forged&code=google-code');
  // Then
  assert.equal(response.headers.get('location'), '/login/?error=failed');
  assert.deepEqual(f.outbound, []);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('a cancelled authorization clears the flow without contacting Google', async t => {
  // Given
  const f = await fixture(t);
  const token = await signCookie(flow, 'oauth', config, Math.floor(Date.now() / 1000));
  // When
  const response = await f.request(`/auth/google/callback?state=${flow.state}&error=access_denied`, {
    headers: { cookie: `${FLOW_COOKIE}=${token}` },
  });
  // Then
  assert.equal(response.headers.get('location'), '/login/?error=cancelled');
  assert.equal(response.headers.getSetCookie()[0].endsWith('Max-Age=0'), true);
  assert.deepEqual(f.outbound, []);
});

test('rejects an unapproved host rather than using it for an OAuth redirect', async t => {
  // Given
  const f = await fixture(t);
  // When
  const response = await onRequest({ request: new Request('https://deployment-10.example.test/auth/google'), env: f.env });
  // Then
  assert.equal(response.status, 403);
  assert.equal(response.headers.has('location'), false);
});

test('missing OAuth configuration returns an unavailable state instead of starting a broken flow', async t => {
  // Given
  const f = await fixture(t);
  // When
  const response = await onRequest({
    request: new Request(`${origin}/auth/google`),
    env: { ...f.env, GOOGLE_CLIENT_SECRET: '' },
  });
  // Then
  assert.equal(response.status, 503);
  assert.equal(response.headers.has('location'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
