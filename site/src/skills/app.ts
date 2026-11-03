import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { PrivateSkillCatalog, PrivateSkillId } from "../../../shared/dist/private-skills.js";
import type { SessionUser } from "../../lib/account.ts";
import { classifyFailure, describeFailure, isUnauthorized, readCatalog, readSession } from "./api.ts";
import type { SessionState } from "./api.ts";
import { LibraryPanel } from "./library.ts";
import { skillHash, skillIdFromHash, sortByUpdated } from "./model.ts";
import { PublishPanel } from "./publish.ts";
import { SkillPanel } from "./skill.ts";

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
  const text = phase.kind === "expired" ? "Your session ended, so your skills were cleared from this page. Sign in again to continue." :
    phase.kind === "signed-out" ? "Not signed in. Your private skills are shown only after you sign in." :
    phase.kind === "unreachable" ? "Couldn't reach the account service. Check your connection and reload." :
    "The account service didn't answer as expected. Try again later.";
  return h("div", { class: "auth-actions dash-signed-out" },
    h("p", { class: "note session-status", role: "status", "aria-live": "polite" }, text),
    h("a", { class: "button primary", href: "/auth/google" }, "Continue with Google ", h("span", { "aria-hidden": "true" }, "\u2192")),
    h("p", { class: "note" }, "Google asks for your consent on its own page. skillar then stores your Google ID, email, name, picture, and your first and latest sign-in times. Your session is a signed, secure cookie. Google tokens aren't retained."));
}

function AccountLine({ user }: { readonly user: SessionUser }) {
  return h("div", { class: "dash-account" },
    h("div", { class: "account-user" },
      h("div", null,
        h("p", { class: "note" }, "Signed in as"),
        h("p", { class: "account-name" }, user.name === "" ? user.email : user.name),
        user.name !== "" && h("p", { class: "account-email" }, user.email))),
    h("form", { method: "post", action: "/auth/logout" }, h("button", { class: "button secondary", type: "submit" }, "Sign out")));
}

type FocusTarget = { readonly skillId: PrivateSkillId; readonly n: number };

export function SkillsApp({ signal }: { readonly signal: AbortSignal }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading", catalog: null, message: "" });
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<PrivateSkillId | null>(() => skillIdFromHash(location.hash));
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [notice, setNotice] = useState("");
  const openedByUser = useRef(false);

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
    const onHash = () => {
      const skillId = skillIdFromHash(location.hash);
      setSelected(skillId);
      if (openedByUser.current && skillId !== null) setFocusTarget(current => ({ skillId, n: (current?.n ?? 0) + 1 }));
      else setFocusTarget(null);
      openedByUser.current = false;
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
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
      else setCatalog(current => ({ status: "failed", catalog: current.catalog, message: describeFailure(error, "Loading your skills") }));
    });
    return () => { active = false; };
  }, [phase.kind, tick, signal]);

  const open = (skillId: PrivateSkillId) => {
    setNotice("");
    if (location.hash === skillHash(skillId)) {
      setFocusTarget(current => ({ skillId, n: (current?.n ?? 0) + 1 }));
      return;
    }
    openedByUser.current = true;
    location.hash = skillHash(skillId);
  };
  const back = () => {
    location.hash = "";
    document.getElementById("library-title")?.focus();
  };
  const deleted = (name: string) => {
    setNotice(`Deleted ${name === "" ? "the skill" : name}.`);
    back();
    reload();
  };

  if (phase.kind === "checking") return h("p", { class: "note session-status", role: "status", "aria-live": "polite" }, "Checking your account\u2026");
  if (phase.kind !== "signed-in") return h(SignedOut, { phase });
  if (catalog.status === "unavailable") {
    return h("div", null,
      h(AccountLine, { user: phase.user }),
      h("p", { class: "note skills-unavailable", role: "status", "aria-live": "polite" },
        "Private skills aren't available on this deployment yet. Nothing was uploaded, and nothing on this page is stored."));
  }
  const skills = catalog.catalog === null ? [] : sortByUpdated(catalog.catalog);
  const summary = selected === null ? null : skills.find(skill => skill.skillId === selected) ?? null;
  const libraryStatus = catalog.status === "ready" ? "ready" : catalog.status === "failed" ? "failed" : "loading";
  return h("div", null,
    h(AccountLine, { user: phase.user }),
    h(LibraryPanel, { skills, status: libraryStatus, message: catalog.message, notice, selectedId: selected, signal,
      onReload: reload, onOpen: open, onUnauthorized: expire }),
    selected !== null && h(SkillPanel, { key: selected, skillId: selected, summary, signal,
      focusHeading: focusTarget !== null && focusTarget.skillId === selected ? focusTarget.n : 0,
      onChanged: reload, onDeleted: deleted, onBack: back, onUnauthorized: expire }),
    h(PublishPanel, { signal, onPublished: reload, onOpen: open, onUnauthorized: expire }));
}
