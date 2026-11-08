import { REPORT_PART_BYTES } from "./report-store.ts";
import { writeReportPart } from "./report-objects.ts";
import { ReportError } from "./report-types.ts";
import type { ReportEnv, ReportJob } from "./report-types.ts";
import type { IngestPrincipal } from "./types.ts";

// The DOM Crypto interface masks this native Workers extension in the mixed provider declarations.
declare global { interface Crypto { DigestStream: typeof DigestStream } }

const MAX_REPORT_BYTES = 512 * 1024 * 1024;
const omitted = (value: unknown) => value === undefined || typeof value === "function" || typeof value === "symbol";
/** Report DTOs are plain JSON values; preserve native object order and undefined semantics. */
function* tokens(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    yield "[";
    for (let index = 0; index < value.length; index++) {
      if (index > 0) yield ",";
      yield* tokens(value[index]);
    }
    yield "]";
  } else if (value !== null && typeof value === "object") {
    yield "{";
    let first = true;
    for (const [key, field] of Object.entries(value)) {
      if (omitted(field)) continue;
      if (!first) yield ",";
      first = false;
      yield JSON.stringify(key); yield ":"; yield* tokens(field);
    }
    yield "}";
  } else {
    yield JSON.stringify(value) ?? "null";
  }
}
/** Bound memory by one string token and one encrypted part, not the expanded full report. */
export async function writeReportResult(
  env: ReportEnv, principal: IngestPrincipal, job: ReportJob, payload: unknown,
) {
  const digest = new crypto.DigestStream("SHA-256"), writer = digest.getWriter();
  const encoder = new TextEncoder();
  let buffer = new Uint8Array(REPORT_PART_BYTES), size = 0, bytes = 0, parts = 0;
  const flush = async () => {
    if (size === 0) return;
    const part = buffer.subarray(0, size);
    await writer.write(part);
    await writeReportPart(env, principal, job, "result", parts++, part);
    buffer = new Uint8Array(REPORT_PART_BYTES);
    size = 0;
  };
  try {
    for (const token of tokens(payload)) {
      for (let start = 0; start < token.length;) {
        let end = Math.min(start + 32_768, token.length);
        // TextEncoder must see a surrogate pair together, even at a token slice boundary.
        if (end < token.length && token.charCodeAt(end - 1) >= 0xd800 && token.charCodeAt(end - 1) <= 0xdbff &&
            token.charCodeAt(end) >= 0xdc00 && token.charCodeAt(end) <= 0xdfff) end--;
        const encoded = encoder.encode(token.slice(start, end));
        bytes += encoded.length;
        if (bytes > MAX_REPORT_BYTES) throw new ReportError("report_pressure");
        for (let offset = 0; offset < encoded.length;) {
          const count = Math.min(encoded.length - offset, buffer.length - size);
          buffer.set(encoded.subarray(offset, offset + count), size);
          size += count;
          offset += count;
          if (size === buffer.length) await flush();
        }
        start = end;
      }
    }
    await flush();
    await writer.close();
    const hash = [...new Uint8Array(await digest.digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return { parts, bytes, hash };
  } catch (error) {
    await writer.abort(new Error("report_failed"));
    throw error;
  }
}
