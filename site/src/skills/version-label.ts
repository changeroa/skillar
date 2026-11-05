import { h } from "preact";
import type { PrivateSkillDetail } from "../../../shared/dist/private-skills.js";
import { shortKstDate } from "../time.ts";

/** Display index of retained versions, not the head's mutable revision counter. */
export function versionLabel(detail: PrivateSkillDetail, digest: string): string {
  const versions = [...detail.versions].sort((a, b) => a.createdAt - b.createdAt || a.digest.localeCompare(b.digest));
  const index = versions.findIndex(version => version.digest === digest);
  const version = versions[index];
  if (version === undefined) return digest.slice(0, 8);
  return `r${index + 1} · ${digest.slice(0, 8)} · ${shortKstDate(version.createdAt)}${digest === detail.skill.head.digest ? " · 현재" : ""}${version.pinned ? " · 고정" : ""}`;
}

export function DigestField({ digest }: { readonly digest: string }) {
  return h("details", { class: "technical" }, h("summary", null, "전체 식별자 복사"),
    h("label", { class: "field-label" }, "전체 digest · 선택 후 복사",
      h("input", { class: "text-field version__digest", style: { fontFamily: "ui-monospace, monospace" }, type: "text", readOnly: true,
        "data-digest-copy": "", value: digest, onFocus: event => event.currentTarget.select() })));
}
