import { z } from "zod";
import { deploymentOriginSchema } from "./cloud-wire.js";
import { CloudSyncError } from "./cloud-blobs.js";

export const cloudOriginSchema = deploymentOriginSchema.refine(value => value.startsWith("https://"));
export type CloudState = "auth-required" | "consent-required" | "retry" | "quarantined" | "disabled";
export class CloudRequestError extends CloudSyncError {
  constructor(
    readonly state: CloudState, code: string,
    readonly status: number, readonly retryAtMs: number | null = null,
  ) {
    super(code);
    this.name = "CloudRequestError";
  }
}
export function retryAt(
  header: string | null, attempt: number, now = Date.now(), random = Math.random,
): number {
  const base = Math.min(60_000, 1000 * 2 ** Math.min(Math.max(attempt, 0), 20));
  const seconds = header !== null && /^\d+$/.test(header) ? Number(header) : null;
  const date = header === null ? NaN : Date.parse(header);
  const specified = seconds !== null ? now + seconds * 1000 : date;
  const floor = Number.isFinite(specified) ? Math.max(now, specified) : now + base;
  return floor + Math.floor(random() * base / 4);
}
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError"));
}
async function discardBody(
  body: { cancel(): Promise<void> } | null, failure: CloudRequestError,
): Promise<never> {
  try { await body?.cancel(); } catch (error) {
    if (!isNetworkError(error)) throw error;
  }
  throw failure;
}
async function readJson(response: Response, limit: number): Promise<unknown> {
  if (response.body === null) throw new CloudRequestError("quarantined", "invalid_response", response.status);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        return await discardBody(reader,
          new CloudRequestError("quarantined", "response_too_large", response.status));
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new CloudRequestError("quarantined", "invalid_response", response.status);
    }
    throw error;
  }
}

/** One bounded attempt. The durable scheduler, not a sleeping request, owns retries. */
export class CloudHttp {
  readonly origin: z.infer<typeof cloudOriginSchema>;
  constructor(
    origin: string, readonly token: string | null,
    readonly fetcher: typeof fetch = fetch, readonly timeoutMs = 30_000,
    readonly attempt = 0,
  ) {
    this.origin = cloudOriginSchema.parse(origin);
    z.number().int().min(1).max(30_000).parse(timeoutMs);
    z.number().int().nonnegative().parse(attempt);
  }
  async request(
    path: string, options: {
      readonly body?: string; readonly maxResponseBytes?: number; readonly attempt?: number;
    } = {},
  ): Promise<unknown> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !path.startsWith("/v1/")) {
      throw new CloudSyncError("invalid_remote_target");
    }
    if (options.body !== undefined && Buffer.byteLength(options.body) > 256 * 1024) {
      throw new CloudSyncError("request_too_large");
    }
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: options.body === undefined ? "GET" : "POST",
        headers: {
          ...(this.token === null ? {} : { authorization: `Bearer ${this.token}` }),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: options.body, redirect: "manual", credentials: "omit", cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isNetworkError(error)) {
        throw new CloudRequestError("retry", "network_unavailable", 0,
          retryAt(null, options.attempt ?? this.attempt));
      }
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      return discardBody(response.body,
        new CloudRequestError("quarantined", "unsafe_redirect", response.status));
    }
    if (response.status === 429 || response.status >= 500) {
      return discardBody(response.body, new CloudRequestError("retry",
        response.status === 429 ? "rate_limited" : "remote_unavailable", response.status,
        retryAt(response.headers.get("retry-after"), options.attempt ?? this.attempt)));
    }
    let value: unknown;
    try {
      value = await readJson(response, options.maxResponseBytes ?? 256 * 1024);
    } catch (error) {
      if (isNetworkError(error)) {
        throw new CloudRequestError("retry", "network_unavailable", response.status,
          retryAt(null, options.attempt ?? this.attempt));
      }
      throw error;
    }
    if (response.ok) return value;
    const parsed = z.object({ error: z.string().regex(/^[a-z0-9_]{1,100}$/) }).safeParse(value);
    const code = parsed.success ? parsed.data.error : "remote_error";
    if (response.status === 401 || response.status === 403) {
      const state = ["consent_required", "content_not_allowed", "range_not_allowed"].includes(code)
        ? "consent-required" : "auth-required";
      throw new CloudRequestError(state, code, response.status);
    }
    if (response.status === 404) throw new CloudRequestError("disabled", code, response.status);
    throw new CloudRequestError("quarantined", code, response.status);
  }
}
