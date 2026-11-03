import { z } from "zod";
import { mcpConnectionsSchema, mcpPatRequestSchema, mcpPatResponseSchema } from "../../shared/dist/mcp-auth.js";
import type { McpConnectionSummary } from "../../shared/dist/mcp-auth.js";

type McpConnections = z.output<typeof mcpConnectionsSchema>;
export type PatRequest = z.output<typeof mcpPatRequestSchema>;
export type PatResponse = z.output<typeof mcpPatResponseSchema>;

/** Same-origin browser routes from the P11 contract. The Google session cookie is the only credential. */
export const routes = {
  connections: "/api/mcp/connections",
  connection: (connectionId: string) => `/api/mcp/connections/${encodeURIComponent(connectionId)}`,
  signIn: "/auth/google?returnTo=%2Fconnections%2F",
} as const;

const revokedSchema = z.object({ revoked: z.literal(true) });
const errorSchema = z.object({ error: z.string().min(1).max(100) });

export class ConnectionsRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`${code} (${status})`);
    this.name = "ConnectionsRequestError";
    this.status = status;
    this.code = code;
  }
}

export type Failure = "signed-out" | "disabled" | "rejected" | "rate-limited" | "unavailable" | "unreachable" | "unexpected" | "other";

export function classifyFailure(error: unknown): Failure {
  if (error instanceof TypeError) return "unreachable";
  if (!(error instanceof ConnectionsRequestError)) return error instanceof Error && /ZodError$/.test(error.name) ? "unexpected" : "other";
  if (error.status === 401) return "signed-out";
  if (error.status === 404) return "disabled";
  if (error.status === 429) return "rate-limited";
  if (error.status >= 500) return "unavailable";
  return [400, 413, 415, 422].includes(error.status) ? "rejected" : "other";
}

async function errorCode(response: Response): Promise<string> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error : `http_${response.status}`;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return `http_${response.status}`;
    throw error;
  }
}

async function call<S extends z.ZodType>(path: string, schema: S, init: { readonly method: "GET" | "POST" | "DELETE"; readonly body?: object }): Promise<z.output<S>> {
  const response = await fetch(path, {
    method: init.method, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
    headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) throw new ConnectionsRequestError(response.status, await errorCode(response));
  return schema.parse(await response.json());
}

export const readConnections = (): Promise<McpConnections> => call(routes.connections, mcpConnectionsSchema, { method: "GET" });

/** Issues one token. Only the form's submit calls this; the returned token is held in memory until dismissed. */
export const createPat = (body: PatRequest): Promise<PatResponse> => call(routes.connections, mcpPatResponseSchema, { method: "POST", body });

export const revokeConnection = async (connectionId: string): Promise<void> => { await call(routes.connection(connectionId), revokedSchema, { method: "DELETE" }); };

export type PatDraft = { readonly name: string; readonly expiresInDays: string; readonly recordActivity: boolean };
export type DraftCheck = { readonly ok: true; readonly body: PatRequest } | { readonly ok: false; readonly problems: readonly string[] };

export const emptyDraft = (): PatDraft => ({ name: "", expiresInDays: "7", recordActivity: false });

export function checkDraft(draft: PatDraft): DraftCheck {
  const days = /^\s*\d+\s*$/.test(draft.expiresInDays) ? Number(draft.expiresInDays) : Number.NaN;
  const parsed = mcpPatRequestSchema.safeParse({ name: draft.name, expiresInDays: days, recordActivity: draft.recordActivity });
  if (parsed.success) return { ok: true, body: parsed.data };
  const problems = parsed.error.issues.map(issue => issue.path[0] !== "name" ? "Expiry must be a whole number of days from 1 to 30."
    : draft.name.trim() === "" ? "Give the token a name, so you can tell it apart later." : "Keep the name to 80 characters.");
  return { ok: false, problems: [...new Set(problems)] };
}

export function connectionStatus(connection: McpConnectionSummary, nowSeconds: number): "active" | "expired" | "revoked" {
  return connection.revokedAt !== null ? "revoked" : connection.expiresAt <= nowSeconds ? "expired" : "active";
}

export const sortConnections = (connections: readonly McpConnectionSummary[]): readonly McpConnectionSummary[] =>
  [...connections].sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));

export type Phase = "checking" | "loading" | "ready" | Failure;
export type Model = {
  readonly phase: Phase; readonly resource: string | null; readonly connections: readonly McpConnectionSummary[]; readonly draft: PatDraft;
  readonly creating: boolean; readonly token: string | null; readonly tokenVisible: boolean; readonly confirming: string | null; readonly revoking: string | null;
};
export const initialModel: Model = {
  phase: "checking", resource: null, connections: [], draft: emptyDraft(), creating: false, token: null, tokenVisible: false, confirming: null, revoking: null,
};
export type Event =
  | { readonly type: "load" } | { readonly type: "loaded"; readonly list: McpConnections } | { readonly type: "load-failed"; readonly failure: Failure }
  | { readonly type: "draft"; readonly draft: PatDraft } | { readonly type: "create" }
  | { readonly type: "created"; readonly result: PatResponse } | { readonly type: "create-failed" }
  | { readonly type: "token-visible"; readonly visible: boolean } | { readonly type: "token-dismissed" }
  | { readonly type: "revoke-asked"; readonly connectionId: string } | { readonly type: "revoke-kept" } | { readonly type: "revoke" }
  | { readonly type: "revoked"; readonly connectionId: string; readonly at: number } | { readonly type: "revoke-failed" };

/** Pure transitions. A token enters only through "created" and leaves through "token-dismissed" or a lost session. */
export function update(model: Model, event: Event): Model {
  switch (event.type) {
    case "load": return { ...model, phase: model.phase === "checking" ? "checking" : "loading" };
    case "loaded": return { ...model, phase: "ready", resource: event.list.resource, connections: sortConnections(event.list.connections) };
    case "load-failed": return event.failure === "signed-out" ? { ...initialModel, phase: "signed-out", draft: model.draft }
      : { ...model, phase: event.failure, confirming: null };
    case "draft": return { ...model, draft: event.draft };
    case "create": return { ...model, creating: true };
    case "created": return { ...model, creating: false, draft: emptyDraft(), token: event.result.token, tokenVisible: false,
      connections: sortConnections([event.result.connection, ...model.connections]) };
    case "create-failed": return { ...model, creating: false };
    case "token-visible": return model.token === null ? model : { ...model, tokenVisible: event.visible };
    case "token-dismissed": return { ...model, token: null, tokenVisible: false };
    case "revoke-asked": return { ...model, confirming: event.connectionId };
    case "revoke-kept": return { ...model, confirming: null };
    case "revoke": return { ...model, revoking: model.confirming, confirming: null };
    case "revoked": return { ...model, revoking: null, connections: model.connections.map(connection =>
      connection.connectionId === event.connectionId ? { ...connection, revokedAt: event.at } : connection) };
    case "revoke-failed": return { ...model, revoking: null };
  }
}

const FAILURE_TEXT: Record<Failure, string> = {
  "signed-out": "Not signed in, or your session ended. Sign in to see and manage your connections.",
  disabled: "That connection no longer exists, or MCP connections are switched off on this deployment.",
  rejected: "skillar rejected the request. Check the form and try again.",
  "rate-limited": "Too many requests. Wait a minute and try again.",
  unavailable: "MCP connections are unavailable right now. Try again later.",
  unreachable: "Couldn't reach skillar. Check your connection and try again.",
  unexpected: "skillar answered in a way this page doesn't recognise. Nothing was changed.",
  other: "The request failed.",
};
const SCOPE_TEXT: Record<McpConnectionSummary["scopes"][number], string> = {
  "skills:read": "Read private skills", "activity:record": "Record searches and reads", offline_access: "Stay connected without re-approval",
};
const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const formatSeconds = (seconds: number): string => whenFormat.format(new Date(seconds * 1000));

function mount(): void {
  const q = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (element === null) throw new Error(`The connections page has no ${selector} element.`);
    return element;
  };
  const status = q<HTMLElement>("#connections-status"), retry = q<HTMLButtonElement>("#retry"), signedOut = q<HTMLElement>("#signed-out");
  const disabled = q<HTMLElement>("#disabled"), app = q<HTMLElement>("#connections-app"), form = q<HTMLFormElement>("#pat-form");
  const name = q<HTMLInputElement>("#pat-name"), days = q<HTMLInputElement>("#pat-days"), record = q<HTMLInputElement>("#pat-record");
  const create = q<HTMLButtonElement>("#pat-create"), problems = q<HTMLElement>("#pat-problems"), patStatus = q<HTMLElement>("#pat-status");
  const tokenPanel = q<HTMLElement>("#token-panel"), tokenTitle = q<HTMLElement>("#token-title"), token = q<HTMLInputElement>("#token");
  const toggle = q<HTMLButtonElement>("#token-toggle"), copy = q<HTMLButtonElement>("#token-copy"), dismiss = q<HTMLButtonElement>("#token-dismiss");
  const tokenStatus = q<HTMLElement>("#token-status"), list = q<HTMLElement>("#connection-list"), empty = q<HTMLElement>("#connections-empty");
  const listStatus = q<HTMLElement>("#list-status"), card = q<HTMLTemplateElement>("#connection-card");
  let model = initialModel;
  let focusAfter: string | null = null;

  const renderCard = (connection: McpConnectionSummary): HTMLElement => {
    const item = card.content.firstElementChild?.cloneNode(true);
    if (!(item instanceof HTMLElement)) throw new Error("The connection card template is empty.");
    const state = connectionStatus(connection, Date.now() / 1000);
    const confirming = model.confirming === connection.connectionId;
    item.dataset["id"] = connection.connectionId;
    const facts: Record<string, string> = {
      name: connection.name, kind: connection.kind === "oauth" ? "OAuth client" : "Personal access token",
      scopes: connection.scopes.map(scope => SCOPE_TEXT[scope]).join(", "),
      recording: connection.recordActivity ? "On. Searches and reads are recorded." : "Off",
      created: formatSeconds(connection.createdAt), expires: formatSeconds(connection.expiresAt),
      status: state === "revoked" ? `Revoked ${formatSeconds(connection.revokedAt ?? connection.expiresAt)}` : state === "expired" ? "Expired" : "Active",
    };
    for (const [key, text] of Object.entries(facts)) item.querySelectorAll<HTMLElement>(`[data-${key}]`).forEach(element => { element.textContent = text; });
    item.querySelectorAll<HTMLElement>("[data-action], [data-consequence]").forEach(control => {
      control.hidden = state === "revoked" || (control.dataset["action"] === "revoke" ? confirming : !confirming);
      if (control instanceof HTMLButtonElement) control.disabled = model.revoking !== null;
    });
    return item;
  };
  const render = () => {
    const phase = model.phase;
    status.textContent = phase === "checking" ? "Checking your connections\u2026" : phase === "loading" ? "Loading your connections\u2026"
      : phase === "ready" || phase === "disabled" ? "" : FAILURE_TEXT[phase];
    retry.hidden = ["checking", "loading", "ready", "signed-out", "disabled"].includes(phase);
    signedOut.hidden = phase !== "signed-out";
    disabled.hidden = phase !== "disabled";
    app.hidden = model.resource === null;
    document.querySelectorAll<HTMLElement>("[data-resource]").forEach(element => { element.textContent = model.resource ?? ""; });
    if (name.value !== model.draft.name) name.value = model.draft.name;
    if (days.value !== model.draft.expiresInDays) days.value = model.draft.expiresInDays;
    record.checked = model.draft.recordActivity;
    create.disabled = model.creating;
    tokenPanel.hidden = model.token === null;
    Object.assign(token, { value: model.token ?? "", type: model.tokenVisible ? "text" : "password" });
    Object.assign(toggle, { textContent: model.tokenVisible ? "Hide token" : "Show token", ariaPressed: String(model.tokenVisible) });
    empty.hidden = model.resource === null || model.connections.length > 0;
    list.replaceChildren(...model.connections.map(renderCard));
    if (focusAfter !== null) document.querySelector<HTMLElement>(focusAfter)?.focus();
    focusAfter = null;
  };
  const dispatch = (event: Event) => { model = update(model, event); render(); };
  const fail = (error: unknown, target: HTMLElement) => {
    const failure = classifyFailure(error);
    if (failure === "signed-out") dispatch({ type: "load-failed", failure });
    else target.textContent = failure === "other" && error instanceof ConnectionsRequestError ? `The request failed (${error.code}).` : FAILURE_TEXT[failure];
  };
  const load = async () => {
    dispatch({ type: "load" });
    try { dispatch({ type: "loaded", list: await readConnections() }); }
    catch (error) { dispatch({ type: "load-failed", failure: classifyFailure(error) }); }
  };
  const revoke = async (connectionId: string) => {
    dispatch({ type: "revoke" });
    listStatus.textContent = "Revoking\u2026";
    listStatus.focus({ preventScroll: true });
    try {
      await revokeConnection(connectionId);
      dispatch({ type: "revoked", connectionId, at: Math.floor(Date.now() / 1000) });
      listStatus.textContent = "Revoked. The agent that used it has lost access.";
    } catch (error) {
      dispatch({ type: "revoke-failed" });
      fail(error, listStatus);
    }
  };

  form.addEventListener("input", () => dispatch({ type: "draft", draft: { name: name.value, expiresInDays: days.value, recordActivity: record.checked } }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const check = checkDraft(model.draft);
    problems.replaceChildren(...(check.ok ? [] : check.problems).map(text => Object.assign(document.createElement("li"), { textContent: text })));
    if (!check.ok) return;
    dispatch({ type: "create" });
    patStatus.textContent = "Creating the token\u2026";
    try {
      dispatch({ type: "created", result: await createPat(check.body) });
      patStatus.textContent = tokenStatus.textContent = "";
      tokenTitle.focus();
    } catch (error) {
      dispatch({ type: "create-failed" });
      fail(error, patStatus);
    }
  });
  toggle.addEventListener("click", () => dispatch({ type: "token-visible", visible: !model.tokenVisible }));
  copy.addEventListener("click", async () => {
    if (model.token === null) return;
    try {
      await navigator.clipboard.writeText(model.token);
      tokenStatus.textContent = "Token copied. Paste it into your agent, then dismiss it here.";
    } catch (error) {
      // Insecure contexts expose no clipboard (TypeError); denied permission is a DOMException.
      if (!(error instanceof DOMException || error instanceof TypeError)) throw error;
      dispatch({ type: "token-visible", visible: true });
      token.select();
      tokenStatus.textContent = "Couldn't copy. The token is shown and selected; copy it manually.";
    }
  });
  dismiss.addEventListener("click", () => { dispatch({ type: "token-dismissed" }); tokenStatus.textContent = ""; name.focus(); });
  list.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-action]") : null;
    const connectionId = button?.closest<HTMLElement>("[data-id]")?.dataset["id"];
    if (!button || connectionId === undefined) return;
    const action = button.dataset["action"];
    if (action === "confirm") return void revoke(connectionId);
    focusAfter = `[data-id="${connectionId}"] [data-action="${action === "revoke" ? "keep" : "revoke"}"]`;
    dispatch(action === "revoke" ? { type: "revoke-asked", connectionId } : { type: "revoke-kept" });
  });
  retry.addEventListener("click", () => void load());
  // A restored back/forward cache page must not show a token that was on screen when the person left.
  addEventListener("pagehide", () => dispatch({ type: "token-dismissed" }));
  render();
  void load();
}

if (typeof document !== "undefined" && document.querySelector("#connections-app") !== null) mount();
