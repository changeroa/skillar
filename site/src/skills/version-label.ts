import { h } from "preact";
import type { PrivateSkillDetail } from "../../../shared/dist/private-skills.js";
import { shortKstDate } from "../time.ts";

/** Only the current head has a known revision; retained order is a separate number. */
export function versionLabel(detail: PrivateSkillDetail, digest: string, compact = false): string {
  const versions = [...detail.versions].sort((a, b) => a.createdAt - b.createdAt || a.digest.localeCompare(b.digest));
  const index = versions.findIndex(version => version.digest === digest);
  const version = versions[index];
  if (version === undefined) return digest.slice(0, 8);
  const current = digest === detail.skill.head.digest;
  const number = current ? `r${detail.skill.head.revision}` : `보관 #${index + 1}`;
  if (compact) return `${current ? "현재 " : ""}${number} · ${digest.slice(0, 8)}${version.pinned ? " · 고정" : ""}`;
  return `${number} · ${digest.slice(0, 8)} · ${shortKstDate(version.createdAt)}${current ? " · 현재" : ""}${version.pinned ? " · 고정" : ""}`;
}

export function DigestField({ digest }: { readonly digest: string }) {
  return h("details", { class: "technical" }, h("summary", null, "전체 식별자 복사"),
    h("label", { class: "field-label" }, "전체 digest · 선택 후 복사",
      h("input", { class: "text-field version__digest", style: { fontFamily: "ui-monospace, monospace" }, type: "text", readOnly: true,
        "data-digest-copy": "", value: digest, onFocus: event => event.currentTarget.select() })));
}
