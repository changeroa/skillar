import { z } from "zod";
import {
  privatePackCreateSchema, privatePackUpdateSchema, privatePackStatusSchema,
  privatePackReceiptSchema, privatePackSearchResultSchema,
} from "../../../shared/dist/private-packs.js";
import type {
  PrivatePackCreate, PrivatePackUpdate,
} from "../../../shared/dist/private-packs.js";
import { DashboardRequestError } from "./api.ts";

const failureSchema = z.object({ error: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/) });

async function post<S extends z.ZodType>(
  action: string, body: object, schema: S, signal: AbortSignal, allowFailed = false,
): Promise<z.output<S>> {
  const response = await fetch(`/api/packs/${action}`, {
    method: "POST", credentials: "same-origin", mode: "same-origin",
    cache: "no-store", redirect: "error", signal,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const receipt = privatePackReceiptSchema.safeParse(value);
    if (allowFailed && receipt.success && receipt.data.status === "failed") return schema.parse(value);
    const failure = failureSchema.safeParse(value);
    throw new DashboardRequestError(response.status, failure.success ? failure.data.error : `http_${response.status}`);
  }
  return schema.parse(value);
}

export function publishPrivatePack(
  request: { action: "create"; body: PrivatePackCreate } | { action: "update"; body: PrivatePackUpdate },
  signal: AbortSignal,
) {
  const body = request.action === "create" ? privatePackCreateSchema.parse(request.body) : privatePackUpdateSchema.parse(request.body);
  return post(request.action, body, privatePackReceiptSchema, signal, true);
}

export function readPrivatePackStatus(input: unknown, signal: AbortSignal) {
  return post("status", privatePackStatusSchema.parse(input), privatePackReceiptSchema, signal);
}

export function readPrivatePacks(signal: AbortSignal) {
  return post("search", { mode: "explicit", query: "", offset: 0, limit: 5 }, privatePackSearchResultSchema, signal);
}
