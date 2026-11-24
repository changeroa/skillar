import { z } from "zod";
import type { McpObservationContext } from "../../../shared/mcp-auth.ts";

const nameSchema = z.string().min(1).max(200);
const sessionIdSchema = z.string().min(1).max(200);
const explicitOmoSessionSchema = z.uuid();
const clientSchema = z.object({ name: nameSchema });

export function isOmoMcpClient(name: string): boolean {
  return ["omo", "senpi", "senpi-mcp-client"].includes(name.toLowerCase());
}

export function observationIdentity(
  context: McpObservationContext, request: {
    readonly clientName: string | undefined; readonly meta: Record<string, unknown> | undefined;
  }, sessionHeader: string | null,
): McpObservationContext["observationIdentity"] {
  const { meta } = request;
  const wireClient = nameSchema.safeParse(request.clientName).data ??
    clientSchema.safeParse(meta?.["io.modelcontextprotocol/clientInfo"]).data?.name;
  const clientName = wireClient ?? (isOmoMcpClient(context.clientName) ? context.clientName : undefined);
  const explicit = explicitOmoSessionSchema.safeParse(meta?.["app.skillar/omoSessionId"]).data ??
    explicitOmoSessionSchema.safeParse(sessionHeader).data;
  const canAttribute = clientName === undefined ? explicit !== undefined : isOmoMcpClient(clientName);
  const omoSessionId = canAttribute
    ? sessionIdSchema.safeParse(meta?.sessionId).data ?? explicit
    : undefined;
  if (clientName === undefined && omoSessionId === undefined) return undefined;
  return { clientName, omoSessionId };
}
