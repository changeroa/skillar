import { h } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { PrivateSkillCatalog, PrivateSkillId, PrivateSkillSummary } from "../../../shared/dist/private-skills.js";
import type { SessionUser } from "../../lib/account.ts";
import { classifyFailure, describeFailure, isUnauthorized, readCatalog, readSession } from "./api.ts";
import type { SessionState } from "./api.ts";
import { LibraryPanel, visibleSkills } from "./library.ts";
import { sortByUpdated } from "./model.ts";
import { PublishPanel } from "./publish.ts";
import { SkillPanel } from "./skill.ts";
import { SkillsHeading } from "./heading.ts";
import { readSkillsView, skillsViewUrl } from "./view-state.ts";
import type { SkillsView } from "./view-state.ts";

type Phase = SessionState | { readonly kind: "checking" } | { readonly kind: "expired" };
type CatalogState = {
  readonly status: "loading" | "ready" | "failed" | "unavailable";
  readonly catalog: PrivateSkillCatalog | null;
  readonly message: string;
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function SignedOut({ phase }: { readonly phase: Exclude<Phase, { kind: "signed-in" | "checking" }> }) {
  const text = phase.kind === "expired" ? "로그인이 만료되어 이 화면에서 스킬 정보를 지웠습니다. 계속하려면 다시 로그인하세요." :
    phase.kind === "signed-out" ? "로그인하지 않았습니다. 비공개 스킬은 로그인한 뒤에만 볼 수 있습니다." :
    phase.kind === "unreachable" ? "계정 서비스에 연결하지 못했습니다. 연결을 확인하고 새로고침하세요." :
    "계정 서비스의 응답을 확인할 수 없습니다. 나중에 다시 시도하세요.";
  return h("div", { class: "auth-actions dash-signed-out" },
    h("p", { class: "note session-status", role: "status", "aria-live": "polite" }, text),
    h("a", { class: "button primary", href: "/auth/google" }, "Google로 계속 ", h("span", { "aria-hidden": "true" }, "\u2192")),
    h("p", { class: "note" }, "Google 페이지에서 동의를 받습니다. 이후 skillar는 Google ID, 이메일, 이름, 사진과 최초·최근 로그인 시각을 저장합니다. 로그인 상태는 서명된 보안 쿠키로 유지하며, Google 토큰은 보관하지 않습니다."));
}

function AccountLine({ user }: { readonly user: SessionUser }) {
  return h("div", { class: "dash-account" },
    h("div", { class: "account-user" }, h("div", null,
      h("p", { class: "note" }, "로그인 계정"),
      h("p", { class: "account-name" }, user.name === "" ? user.email : user.name),
      user.name !== "" && h("p", { class: "account-email" }, user.email))),
    h("form", { method: "post", action: "/auth/logout" },
      h("button", { class: "button secondary", type: "submit" }, "로그아웃")));
}

export function SkillsApp({ signal }: { readonly signal: AbortSignal }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading", catalog: null, message: "" });
  const [tick, setTick] = useState(0);
  const [view, setView] = useState(() => readSkillsView(location.href));
  const selected = view.selected;
  const [resolved, setResolved] = useState<PrivateSkillSummary | null>(null);
  const [notice, setNotice] = useState("");
  const dirty = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasFull = useRef(view.full);
  const onDirtyChange = useCallback((next: boolean) => { dirty.current = next; }, []);
  const onResolved = useCallback((skill: PrivateSkillSummary) => setResolved(skill), []);
  useLayoutEffect(() => {
    if (selected === null && returnFocus.current) {
      (returnFocus.current.isConnected ? returnFocus.current : document.getElementById("library-title"))?.focus();
    }
  }, [selected]);
  useLayoutEffect(() => {
    if (view.full && !wasFull.current) {
      const title = document.getElementById("skills-page-title");
      if (title) { title.tabIndex = -1; title.focus(); }
    }
    wasFull.current = view.full;
  }, [view.full]);

  const expire = useCallback(() => {
    setPhase({ kind: "expired" });
    setCatalog({ status: "loading", catalog: null, message: "" });
  }, []);
  const reload = useCallback(() => setTick(current => current + 1), []);

  useEffect(() => {
    readSession(signal).then(setPhase, (error: unknown) => {
      if (!isAbort(error)) setPhase({ kind: "unexpected" });
    });
  }, [signal]);

  useEffect(() => {
    const restore = () => {
      const next = readSkillsView(location.href);
      if (next.selected !== viewRef.current.selected && dirty.current &&
          !confirm("저장하지 않은 수정 내용이 사라집니다. 다른 화면으로 이동할까요?")) {
        history.replaceState(null, "", skillsViewUrl(viewRef.current));
        return;
      }
      setView(next);
    };
    addEventListener("hashchange", restore);
    addEventListener("popstate", restore);
    return () => { removeEventListener("hashchange", restore); removeEventListener("popstate", restore); };
  }, []);

  useEffect(() => {
    if (phase.kind !== "signed-in") return;
    let active = true;
    setCatalog(current => ({ status: "loading", catalog: current.catalog, message: "" }));
    readCatalog(signal).then(next => {
      if (active) setCatalog({ status: "ready", catalog: next, message: "" });
    }, (error: unknown) => {
      if (!active || isAbort(error)) return;
      if (isUnauthorized(error)) {
        expire();
        return;
      }
      if (classifyFailure(error) === "gone") setCatalog({ status: "unavailable", catalog: null, message: "" });
      else setCatalog(current => ({ status: "failed", catalog: current.catalog, message: describeFailure(error, "스킬 불러오기") }));
    });
    return () => { active = false; };
  }, [phase.kind, tick, signal]);

  const navigate = (next: SkillsView, replace = false) => {
    if (next.selected !== selected && dirty.current && !confirm("저장하지 않은 수정 내용이 사라집니다. 다른 화면으로 이동할까요?")) return false;
    history[replace ? "replaceState" : "pushState"](null, "", skillsViewUrl(next));
    setView(next);
    return true;
  };
  const open = (skillId: PrivateSkillId, target?: HTMLElement) => {
    setNotice("");
    if (navigate({ ...view, selected: skillId, full: false, digest: "", tab: "versions" }))
      returnFocus.current = target ?? document.getElementById(`skill-row-${skillId}`);
  };
  const back = () => navigate({ ...view, selected: null, full: false, digest: "", tab: "document" });
  const deleted = (name: string) => {
    setNotice(`삭제했습니다: ${name === "" ? "스킬" : name}.`);
    dirty.current = false;
    back();
    reload();
  };

  if (phase.kind === "checking") return h("div", null, h(SkillsHeading, { name: "스킬" }),
    h("p", { class: "note session-status", role: "status", "aria-live": "polite" }, "계정 확인 중\u2026"));
  if (phase.kind !== "signed-in") return h("div", null, h(SkillsHeading, { name: "스킬" }), h(SignedOut, { phase }));
  if (catalog.status === "unavailable") {
    return h("div", null,
      h(AccountLine, { user: phase.user }),
      h(SkillsHeading, { name: "스킬" }),
      h("p", { class: "note skills-unavailable", role: "status", "aria-live": "polite" },
        "이 배포에서는 아직 비공개 스킬을 이용할 수 없습니다. 업로드한 내용이나 이 화면에서 저장한 내용은 없습니다."));
  }
  const skills = catalog.catalog === null ? [] : sortByUpdated(catalog.catalog);
  const summary = selected === null ? null : skills.find(skill => skill.skillId === selected) ?? null;
  const libraryStatus = catalog.status === "ready" ? "ready" : catalog.status === "failed" ? "failed" : "loading";
  const visible = visibleSkills(skills, view);
  const index = visible.findIndex(skill => skill.skillId === selected);
  const adjacent = (offset: number) => {
    const skill = visible[index + offset];
    if (skill) open(skill.skillId);
  };
  return h("div", null,
    h(AccountLine, { user: phase.user }),
    h(SkillsHeading, { name: !view.full ? "스킬" : resolved !== null && resolved.skillId === selected ? resolved.name
      : summary?.name ?? (selected === null ? "스킬" : "스킬을 확인하는 중") }),
    h("div", { hidden: view.full && selected !== null, class: selected !== null ? "skills-list-workspace skills-list-workspace--peek" : "skills-list-workspace" },
      h(LibraryPanel, { skills, status: libraryStatus, message: catalog.message, notice, selectedId: selected, signal,
        onReload: reload, onOpen: open, onUnauthorized: expire, view, onViewChange: next => navigate(next, true) })),
    selected !== null && h(SkillPanel, { key: selected, skillId: selected, summary, signal,
        focusHeading: 0,
        onChanged: reload, onDeleted: deleted, onBack: back, onUnauthorized: expire, onDirtyChange, onResolved,
        view, onViewChange: next => navigate(next, true), returnFocus: returnFocus.current,
        onFullPage: () => navigate({ ...view, full: true }), fullPageHref: skillsViewUrl({ ...view, full: true }),
        ...(index > 0 ? { onPrevious: () => adjacent(-1) } : {}),
        ...(index >= 0 && index < visible.length - 1 ? { onNext: () => adjacent(1) } : {}) }),
    h("div", { hidden: selected !== null },
      h(PublishPanel, { signal, onPublished: reload, onOpen: open, onUnauthorized: expire })));
}
