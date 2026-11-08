import type { FlowListEntry, RuntimeId } from "../../../src/types.js";
import { RUNTIME_LABEL, RUNTIME_MARK } from "../../state";

import { specTagParts, specLabel } from "./model";
export function Chevron() {
  return (
    <svg class="chev" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function SpecTag({ entry }: { entry: FlowListEntry }) {
  if (entry.kind === "outside_herdr") return <span class="tag tag--dim">패널 연결 없음</span>;
  const { name, version } = specTagParts(entry.spec);
  const title = entry.spec
    ? `${specLabel(entry.spec)}: 이 워크플로를 등록할 때 사용한 스펙`
    : "이 herdr 작업 공간에 등록된 워크플로 스펙이 없습니다";
  return (
    <span class={entry.spec ? "tag" : "tag tag--dim"} title={title}>
      <span class="tag__name">{name}</span>
      {version !== null && <span class="tag__suffix">{version}</span>}
    </span>
  );
}

export function Runtime({ runtime }: { runtime: RuntimeId }) {
  return (
    <span class="rt">
      <span class="rt__mark" aria-hidden="true">{RUNTIME_MARK[runtime] ?? RUNTIME_MARK.unknown}</span>
      <span>{RUNTIME_LABEL[runtime] ?? RUNTIME_LABEL.unknown}</span>
    </span>
  );
}
