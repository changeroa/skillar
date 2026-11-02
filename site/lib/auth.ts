import { createRemoteJWKSet, errors, jwtVerify, SignJWT } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { userSchema } from './account.ts';

export { userSchema } from './account.ts';

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const FLOW_SECONDS = 10 * 60;
export const SESSION_COOKIE = '__Host-skillar_session';
export const FLOW_COOKIE = '__Host-skillar_oauth';
const encoder = new TextEncoder();
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export const configSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  SESSION_KEY: z.string().min(32),
  PUBLIC_ORIGIN: z.url().refine(value =>
    value === 'https://site.example.test' || value === 'http://localhost:8788'),
});
export type Config = z.infer<typeof configSchema>;

const flowSchema = z.object({
  state: z.string().min(32),
  nonce: z.string().min(32),
  verifier: z.string().min(43).max(128),
});
export type LoginFlow = z.infer<typeof flowSchema>;
const sessionSchema = z.object({ sub: z.string().min(1), sid: z.string().min(32) });
const googleProfileSchema = userSchema.unwrap().omit({ createdAt: true, lastLogin: true }).extend({
  email_verified: z.literal(true),
  nonce: z.string(),
});

export class AuthenticationError extends Error {
  constructor() {
    super('Invalid authentication');
    this.name = 'AuthenticationError';
  }
}

export function randomToken(): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return bytesToBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function readCookie(request: Request, name: string): string | undefined {
  return request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function signCookie(
  payload: LoginFlow | { readonly sub: string; readonly sid: string },
  purpose: 'oauth' | 'session',
  config: Config,
  now: number,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.PUBLIC_ORIGIN)
    .setAudience(`skillar:${purpose}`)
    .setIssuedAt(now)
    .setExpirationTime(now + (purpose === 'oauth' ? FLOW_SECONDS : SESSION_SECONDS))
    .sign(encoder.encode(config.SESSION_KEY));
}

async function verifyCookie(token: string, purpose: 'oauth' | 'session', config: Config, now: number) {
  try {
    return (await jwtVerify(token, encoder.encode(config.SESSION_KEY), {
      algorithms: ['HS256'],
      typ: 'JWT',
      issuer: config.PUBLIC_ORIGIN,
      audience: `skillar:${purpose}`,
      requiredClaims: ['exp', 'iat'],
      currentDate: new Date(now * 1000),
    })).payload;
  } catch (error) {
    if (error instanceof errors.JOSEError) throw new AuthenticationError();
    throw error;
  }
}

export async function readFlow(request: Request, config: Config, now: number): Promise<LoginFlow> {
  const token = readCookie(request, FLOW_COOKIE);
  if (!token) throw new AuthenticationError();
  const parsed = flowSchema.safeParse(await verifyCookie(token, 'oauth', config, now));
  if (!parsed.success || new URL(request.url).searchParams.get('state') !== parsed.data.state) {
    throw new AuthenticationError();
  }
  return parsed.data;
}

export async function readSession(request: Request, config: Config, now: number) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const parsed = sessionSchema.safeParse(await verifyCookie(token, 'session', config, now));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof AuthenticationError) return null;
    throw error;
  }
}

export async function verifyGoogleToken(
  token: string,
  clientId: string,
  nonce: string,
  now: number,
  keys: JWTVerifyGetKey = googleKeys,
) {
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'nonce'],
      currentDate: new Date(now * 1000),
    });
    const profile = googleProfileSchema.safeParse({
      ...payload, name: payload['name'] ?? '', picture: payload['picture'] ?? '',
    });
    if (!profile.success || profile.data.nonce !== nonce ||
        (payload['azp'] !== undefined && payload['azp'] !== clientId) ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload['azp'] !== clientId)) {
      throw new AuthenticationError();
    }
    const { sub, email, name, picture } = profile.data;
    return { sub, email, name, picture };
  } catch (error) {
    if (error instanceof errors.JOSEError) throw new AuthenticationError();
    throw error;
  }
}
