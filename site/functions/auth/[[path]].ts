import ky, { HTTPError, TimeoutError } from 'ky';
import { z } from 'zod';
import { isDeploymentOrigin } from '../../../shared/dist/deployment-origin.js';
import {
  AuthenticationError, configSchema, cookie, FLOW_COOKIE, FLOW_SECONDS, pkceChallenge,
  randomToken, readFlow, readSession, SESSION_COOKIE, SESSION_SECONDS, signCookie,
  userSchema, verifyGoogleToken,
} from '../../lib/auth.ts';
import { browserPrincipal } from '../../lib/activity-auth.ts';
import type { ActivityEnv } from '../../lib/activity-auth.ts';
import { revokeEventSession } from '../../lib/activity-events.ts';

interface Env extends ActivityEnv {
  readonly ACCOUNTS: D1Database;
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });
const noStore = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ ...noStore, location });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parsed = configSchema.safeParse(env);
  if (!parsed.success || !env.ACCOUNTS) {
    return Response.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503, headers: noStore });
  }
  // Keep the production Pages alias usable, but never accept arbitrary preview hosts.
  if (!isDeploymentOrigin(url.origin, parsed.data)) {
    return Response.json({ error: 'Use the production sign-in URL.' }, { status: 403, headers: noStore });
  }
  // Each approved host owns its callback, cookie issuer and logout Origin.
  const config = { ...parsed.data, PUBLIC_ORIGIN: url.origin };
  const now = Math.floor(Date.now() / 1000);
  const path = url.pathname.replace(/\/$/, '');

  if (path === '/auth/google' && request.method === 'GET') {
    const flow = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: `${config.PUBLIC_ORIGIN}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: await pkceChallenge(flow.verifier),
      code_challenge_method: 'S256',
    }).toString();
    return redirect(google.href, [
      cookie(FLOW_COOKIE, await signCookie(flow, 'oauth', config, now), FLOW_SECONDS),
    ]);
  }

  if (path === '/auth/google/callback' && request.method === 'GET') {
    const clearFlow = cookie(FLOW_COOKIE, '', 0);
    try {
      const flow = await readFlow(request, config, now);
      if (url.searchParams.has('error')) return redirect('/login/?error=cancelled', [clearFlow]);
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) throw new AuthenticationError();
      const response = await ky.post('https://oauth2.googleapis.com/token', {
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.GOOGLE_CLIENT_ID,
          client_secret: config.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${config.PUBLIC_ORIGIN}/auth/google/callback`,
          code,
          code_verifier: flow.verifier,
        }),
        retry: 0,
        timeout: 10_000,
      }).json<unknown>();
      const tokens = tokenResponseSchema.safeParse(response);
      if (!tokens.success) throw new AuthenticationError();
      const profile = await verifyGoogleToken(tokens.data.id_token, config.GOOGLE_CLIENT_ID, flow.nonce, now);
      const sid = randomToken();
      const session = await signCookie({ sub: profile.sub, sid }, 'session', config, now);
      await env.ACCOUNTS.batch([
        env.ACCOUNTS.prepare(
          `INSERT INTO users (sub, email, name, picture, created_at, last_login)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(sub) DO UPDATE SET email=excluded.email, name=excluded.name,
             picture=excluded.picture, last_login=excluded.last_login`,
        ).bind(profile.sub, profile.email, profile.name, profile.picture, now, now),
        env.ACCOUNTS.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
        env.ACCOUNTS.prepare('INSERT INTO sessions (id, user_sub, expires_at) VALUES (?, ?, ?)')
          .bind(sid, profile.sub, now + SESSION_SECONDS),
      ]);
      return redirect('/login/', [
        clearFlow,
        cookie(SESSION_COOKIE, session, SESSION_SECONDS),
      ]);
    } catch (error) {
      if (!(error instanceof AuthenticationError || error instanceof HTTPError ||
            error instanceof TimeoutError)) throw error;
      // Do not log upstream responses, codes, tokens, profile data or cookies.
      return redirect('/login/?error=failed', [clearFlow]);
    }
  }

  if (path === '/auth/session' && request.method === 'GET') {
    const session = await readSession(request, config, now);
    if (!session) return Response.json({ user: null }, { headers: noStore });
    const row = await env.ACCOUNTS.prepare(
      `SELECT u.sub, u.email, u.name, u.picture, u.created_at AS createdAt, u.last_login AS lastLogin
       FROM users u JOIN sessions s ON s.user_sub = u.sub
       WHERE s.id = ? AND s.user_sub = ? AND s.expires_at > ?`,
    ).bind(session.sid, session.sub, now).first();
    return Response.json({ user: row ? userSchema.parse(row) : null }, { headers: noStore });
  }

  if (path === '/auth/logout' && request.method === 'POST') {
    if (request.headers.get('origin') !== config.PUBLIC_ORIGIN) {
      return Response.json({ error: 'Invalid request origin.' }, { status: 403, headers: noStore });
    }
    const session = await readSession(request, config, now);
    if (session) {
      const principal = env.ACTIVITY_ENABLED === 'true' && env.ACTIVITY_SERVICE !== undefined ?
        await browserPrincipal(request, env) : null;
      await env.ACCOUNTS.prepare('DELETE FROM sessions WHERE id = ? AND user_sub = ?')
        .bind(session.sid, session.sub).run();
      if (principal !== null) await revokeEventSession(env, principal);
    }
    return redirect('/login/', [cookie(SESSION_COOKIE, '', 0), cookie(FLOW_COOKIE, '', 0)]);
  }

  return Response.json({ error: 'Not found.' }, { status: 404, headers: noStore });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  // This boundary returns a safe error without exposing upstream or D1 details.
  try {
    return await handle(request, env);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return Response.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503, headers: noStore });
  }
};
