import { z } from "zod";
import { dashboardResultPartSchema, type DashboardReportStatus } from "../../shared/activity-dashboard";
import { ApiError } from "./api";

export const cloudError = (code: string, message: string) => new ApiError(0, code, message);
const envelopeSchema = z.object({
  generatedAt: z.number(), inputRevision: z.object({
    sequence: z.number(), journalThrough: z.number(), runtimeSequence: z.number(),
  }), analysisVersion: z.number(), coverage: z.json(),
  sourceCapturedAt: z.number(), sourceReceivedAt: z.number().nullable(),
  pending: z.literal(false), payload: z.json(),
});
async function hash(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Verify the entire byte stream before decoding: UTF-8 may cross part boundaries. */
export async function readCloudReport<T>(
  status: DashboardReportStatus, part: (index: number) => Promise<unknown>, signal: AbortSignal,
): Promise<T> {
  const result = status.result;
  if (!result || result.bytes > 512 * 1024 * 1024) throw cloudError("cloud_integrity", "Invalid cloud report manifest.");
  const bytes = new Uint8Array(result.bytes);
  let offset = 0;
  for (let index = 0; index < result.parts; index++) {
    signal.throwIfAborted();
    const value = dashboardResultPartSchema.parse(await part(index));
    if (value.index !== index || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.body)) {
      throw cloudError("cloud_integrity", "Invalid cloud report part.");
    }
    const binary = atob(value.body);
    const chunk = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (chunk.length !== value.bytes || offset + chunk.length > bytes.length || await hash(chunk) !== value.hash) {
      throw cloudError("cloud_integrity", "Cloud report part verification failed.");
    }
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== result.bytes || await hash(bytes) !== result.hash) {
    throw cloudError("cloud_integrity", "Cloud report verification failed.");
  }
  signal.throwIfAborted();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const envelope = envelopeSchema.parse(JSON.parse(text));
  if (envelope.generatedAt !== status.generatedAt || envelope.analysisVersion !== status.analysisVersion ||
      envelope.inputRevision.sequence !== status.inputRevision.sequence ||
      envelope.inputRevision.journalThrough !== status.inputRevision.journalThrough ||
      envelope.inputRevision.runtimeSequence !== status.inputRevision.runtimeSequence ||
      envelope.sourceCapturedAt !== status.sourceCapturedAt || envelope.sourceReceivedAt !== status.sourceReceivedAt) {
    throw cloudError("cloud_integrity", "Cloud report revision verification failed.");
  }
  // DTOs are produced by the same shared analysis implementation as the local API.
  const decoded: { payload: T } = JSON.parse(text);
  return decoded.payload;
}
