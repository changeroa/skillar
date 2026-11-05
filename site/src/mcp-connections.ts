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

export class UnconfirmedMutation extends Error {
  readonly name = "UnconfirmedMutation";
  readonly method: "POST" | "DELETE";
  constructor(method: "POST" | "DELETE") {
    super("mutation_response_unconfirmed");
    this.method = method;
  }
}

export type Failure = "signed-out" | "disabled" | "rejected" | "rate-limited" | "unavailable" | "unreachable" | "unexpected" | "unconfirmed" | "other";

export function classifyFailure(error: unknown): Failure {
  if (error instanceof UnconfirmedMutation) return "unconfirmed";
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
  try {
    return schema.parse(await response.json());
  } catch (error) {
    if (init.method !== "GET" && (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError)) {
      throw new UnconfirmedMutation(init.method);
    }
    throw error;
  }
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
  const problems = parsed.error.issues.map(issue => issue.path[0] !== "name" ? "만료 기간은 1~30일 사이의 정수로 입력하세요."
    : draft.name.trim() === "" ? "나중에 구분할 수 있도록 토큰 이름을 입력하세요." : "이름은 80자 이내로 입력하세요.");
  return { ok: false, problems: [...new Set(problems)] };
}

export function draftFieldProblems(draft: PatDraft, problems: readonly string[]): { field: "name" | "days"; text: string }[] {
  const invalidName = draft.name.trim() === "" || draft.name.trim().length > 80;
  const invalidDays = !/^\s*\d+\s*$/.test(draft.expiresInDays) || Number(draft.expiresInDays) < 1 || Number(draft.expiresInDays) > 30;
  return [
    ...(invalidName ? [{ field: "name" as const, text: problems.find(problem => problem.includes("토큰 이름") || problem.includes("이름은")) ?? "" }] : []),
    ...(invalidDays ? [{ field: "days" as const, text: problems.find(problem => problem.includes("만료 기간")) ?? "" }] : []),
  ];
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
    case "draft": return model.creating ? model : { ...model, draft: event.draft };
    case "create": return model.creating || model.token !== null ? model : { ...model, creating: true };
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
  "signed-out": "로그인하고 연결을 관리하세요",
  disabled: "이 배포에서는 MCP 연결을 이용할 수 없거나 해당 연결이 없습니다.",
  rejected: "요청이 거부되었습니다. 입력 내용을 확인하고 다시 시도하세요.",
  "rate-limited": "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  unavailable: "지금은 MCP 연결을 불러올 수 없습니다. 다시 시도하세요.",
  unreachable: "skillar에 도달하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.",
  unexpected: "응답 형식을 확인하지 못했습니다. 연결 목록을 다시 불러오세요.",
  unconfirmed: "요청은 전송됐지만 결과를 확인하지 못했습니다. 목록을 다시 불러와 실제 상태를 확인하세요",
  other: "요청을 완료하지 못했습니다.",
};
async function mount(): Promise<void> {
  const [{ h, render: renderView }, { ConnectionsWorkspace }, { Skeleton, Toast }] = await Promise.all([
    import("preact"), import("./connections-workspace"), import("./ui"),
  ]);
  const q = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (element === null) throw new Error(`The connections page has no ${selector} element.`);
    return element;
  };
  const status = q<HTMLElement>("#connections-status"), retry = q<HTMLButtonElement>("#retry"), signedOut = q<HTMLElement>("#signed-out");
  const disabled = q<HTMLElement>("#disabled"), app = q<HTMLElement>("#connections-app"), form = q<HTMLFormElement>("#pat-form");
  const name = q<HTMLInputElement>("#pat-name"), days = q<HTMLInputElement>("#pat-days"), record = q<HTMLInputElement>("#pat-record");
  const create = q<HTMLButtonElement>("#pat-create"), problems = q<HTMLElement>("#pat-problems"), patStatus = q<HTMLElement>("#pat-status");
  const patRetry = q<HTMLButtonElement>("#pat-retry");
  const originalDescribedBy = new Map([name, days].map(field => [field, field.getAttribute("aria-describedby")]));
  const tokenPanel = q<HTMLElement>("#token-panel"), tokenTitle = q<HTMLElement>("#token-title"), token = q<HTMLInputElement>("#token");
  const toggle = q<HTMLButtonElement>("#token-toggle"), copy = q<HTMLButtonElement>("#token-copy"), dismiss = q<HTMLButtonElement>("#token-dismiss");
  const tokenStatus = q<HTMLElement>("#token-status"), list = q<HTMLElement>("#connection-list"), empty = q<HTMLElement>("#connections-empty");
  const listStatus = q<HTMLElement>("#list-status");
  const skeleton = q<HTMLElement>("#connections-loading"), toast = q<HTMLElement>("#connections-toast");
  let model = initialModel;
  let focusAfter: string | null = null;
  const notify = (message: string) => {
    renderView(h(Toast, { message, onDismiss: () => notify("") }), toast);
  };
  const render = () => {
    const phase = model.phase;
    status.hidden = phase === "ready";
    status.textContent = phase === "checking" ? "연결을 확인하는 중…" : phase === "loading" ? "연결을 불러오는 중…"
      : phase === "ready" ? "연결 목록을 불러왔습니다." : FAILURE_TEXT[phase];
    retry.hidden = ["checking", "loading", "ready", "signed-out", "disabled"].includes(phase);
    signedOut.hidden = phase !== "signed-out";
    disabled.hidden = phase !== "disabled";
    app.hidden = model.resource === null;
    renderView(phase === "checking" || phase === "loading" ? h(Skeleton, { label: "연결을 불러오는 중", rows: 4 }) : null, skeleton);
    document.querySelectorAll<HTMLElement>("[data-resource]").forEach(element => { element.textContent = model.resource ?? ""; });
    if (name.value !== model.draft.name) name.value = model.draft.name;
    if (days.value !== model.draft.expiresInDays) days.value = model.draft.expiresInDays;
    record.checked = model.draft.recordActivity;
    name.disabled = days.disabled = record.disabled = model.creating;
    create.disabled = model.creating || model.token !== null;
    if (model.token !== null) patStatus.textContent = "표시된 일회성 토큰을 보관하고 닫은 뒤 새 토큰을 만들 수 있습니다.";
    tokenPanel.hidden = model.token === null;
    Object.assign(token, { value: model.token ?? "", type: model.tokenVisible ? "text" : "password" });
    Object.assign(toggle, { textContent: model.tokenVisible ? "토큰 숨기기" : "토큰 표시", ariaPressed: String(model.tokenVisible) });
    empty.hidden = true;
    if (model.resource !== null) renderView(h(ConnectionsWorkspace, {
      model, operationMessage: listStatus.textContent ?? "",
      onUnauthorized: () => dispatch({ type: "load-failed", failure: "signed-out" }),
    }), list);
    else renderView(null, list);
    if (focusAfter !== null) document.querySelector<HTMLElement>(focusAfter)?.focus();
    focusAfter = null;
  };
  const dispatch = (event: Event) => { model = update(model, event); render(); };
  const fail = (error: unknown, target: HTMLElement) => {
    const failure = classifyFailure(error);
    if (failure === "signed-out") dispatch({ type: "load-failed", failure });
    else {
      target.textContent = target === patStatus && failure === "unavailable"
        ? "지금은 토큰을 만들 수 없습니다. 다시 시도하세요." : FAILURE_TEXT[failure];
      if (target === patStatus) patRetry.hidden = !["unavailable", "rate-limited", "rejected", "other"].includes(failure);
      if (failure === "unconfirmed") {
        const reload = document.createElement("button");
        reload.type = "button";
        reload.className = "button secondary";
        reload.textContent = "목록 다시 불러오기";
        reload.addEventListener("click", () => void load());
        target.append(reload);
      }
    }
  };
  const load = async () => {
    dispatch({ type: "load" });
    try { dispatch({ type: "loaded", list: await readConnections() }); }
    catch (error) { dispatch({ type: "load-failed", failure: classifyFailure(error) }); }
  };
  const revoke = async (connectionId: string) => {
    dispatch({ type: "revoke" });
    listStatus.textContent = "연결을 해제하는 중…";
    render();
    listStatus.focus({ preventScroll: true });
    try {
      await revokeConnection(connectionId);
      dispatch({ type: "revoked", connectionId, at: Math.floor(Date.now() / 1000) });
      listStatus.textContent = "연결을 해제했습니다. 해당 에이전트의 접근이 중단되었습니다.";
      render();
    } catch (error) {
      dispatch({ type: "revoke-failed" });
      fail(error, listStatus);
      render();
    }
  };

  form.addEventListener("input", () => {
    patRetry.hidden = true;
    dispatch({ type: "draft", draft: { name: name.value, expiresInDays: days.value, recordActivity: record.checked } });
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (model.creating || model.token !== null) return;
    patRetry.hidden = true;
    const check = checkDraft(model.draft);
    const errors = check.ok ? [] : draftFieldProblems(model.draft, check.problems).map(({ field, text }) => ({
      element: field === "name" ? name : days,
      item: Object.assign(document.createElement("li"), { id: `pat-problem-${field}`, textContent: text }),
    }));
    for (const field of [name, days]) {
      const error = errors.find(item => item.element === field);
      if (error) {
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", [originalDescribedBy.get(field), error.item.id].filter(Boolean).join(" "));
      } else {
        field.removeAttribute("aria-invalid");
        const original = originalDescribedBy.get(field);
        if (original == null) field.removeAttribute("aria-describedby");
        else field.setAttribute("aria-describedby", original);
      }
    }
    problems.replaceChildren(...errors.map(({ item }) => item));
    q<HTMLElement>("#pat-errors").hidden = check.ok;
    if (!check.ok) {
      errors[0]?.element.focus();
      return;
    }
    dispatch({ type: "create" });
    patStatus.textContent = "토큰을 만드는 중…";
    try {
      dispatch({ type: "created", result: await createPat(check.body) });
      tokenStatus.textContent = "새 토큰을 만들었습니다";
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
      tokenStatus.textContent = "토큰을 복사했습니다. 에이전트에 붙여 넣은 뒤 여기서 닫으세요.";
      notify("복사됨 · 토큰을 클립보드에 복사했습니다.");
    } catch (error) {
      // Insecure contexts expose no clipboard (TypeError); denied permission is a DOMException.
      if (!(error instanceof DOMException || error instanceof TypeError)) throw error;
      dispatch({ type: "token-visible", visible: true });
      token.select();
      tokenStatus.textContent = "복사하지 못했습니다. 선택된 토큰을 직접 복사하세요.";
    }
  });
  dismiss.addEventListener("click", () => { dispatch({ type: "token-dismissed" }); patStatus.textContent = tokenStatus.textContent = ""; name.focus(); });
  q<HTMLSelectElement>("#execution-location").addEventListener("change", event => {
    const remote = event.currentTarget instanceof HTMLSelectElement && event.currentTarget.value === "remote";
    q<HTMLDetailsElement>(".connections-token-form").open = remote;
    notify(remote ? "원격 환경에서 브라우저를 열 수 없다면 개인 액세스 토큰을 사용하세요." : "내 컴퓨터의 MCP 클라이언트에 명령을 추가하고 OAuth로 승인하세요.");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-copy-command]").forEach(button => {
    button.addEventListener("click", async () => {
      const command = document.querySelector<HTMLElement>(button.dataset["copyCommand"] ?? "")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(command);
        notify("복사됨 · 명령을 클립보드에 복사했습니다.");
      } catch (error) {
        if (!(error instanceof DOMException || error instanceof TypeError)) throw error;
        notify("복사하지 못했습니다. 명령을 선택해 직접 복사하세요.");
      }
    });
  });
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

if (typeof document !== "undefined" && document.querySelector("#connections-app") !== null) void mount();
