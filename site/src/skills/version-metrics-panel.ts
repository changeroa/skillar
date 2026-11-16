import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { PrivateSkillDetail } from "../../../shared/dist/private-skills.js";
import { describeFailure, isUnauthorized, readProfiles } from "../dashboard/api";
import { kstDay } from "../time.ts";
import { versionLabel } from "./version-label.ts";
import { isMetricsUnauthorized, readVersionMetrics, VersionMetricsError } from "./version-metrics.ts";
import {
  COUNTED_STATUSES, LOAD_STATUS_LABEL, sampleNote, VERSION_METRICS_PERIODS,
  type VersionMetrics,
} from "./version-metrics-core.ts";

type Props = {
  readonly detail: PrivateSkillDetail;
  readonly before: string;
  readonly after: string;
  readonly signal: AbortSignal;
  readonly onUnauthorized: () => void;
  readonly active?: boolean;
};

type MetricsState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "no-sources" }
  | { readonly kind: "failed"; readonly message: string; readonly technical: string | null }
  | { readonly kind: "ready"; readonly from: number; readonly to: number; readonly before: VersionMetrics; readonly after: VersionMetrics | null };

function kstDateTime(milliseconds: number): string {
  const shifted = new Date(milliseconds + 9 * 3600000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${kstDay(milliseconds)} ${hh}:${mm}`;
}

function statusLine(metrics: VersionMetrics): string {
  const parts = COUNTED_STATUSES.filter(status => metrics.counts[status] > 0)
    .map(status => `${LOAD_STATUS_LABEL[status]} ${metrics.counts[status]}`);
  return parts.join(" · ");
}

function failureMessage(error: unknown): string {
  if (error instanceof VersionMetricsError) return error.message;
  return describeFailure(error, "버전별 읽기 지표");
}

function MetricsCard({ detail, digest, metrics, from, to }: {
  readonly detail: PrivateSkillDetail; readonly digest: string;
  readonly metrics: VersionMetrics; readonly from: number; readonly to: number;
}) {
  const allFailed = metrics.sessionsSampled > 0 && metrics.sessionsExcluded === metrics.sessionsSampled;
  return h("div", { class: "version-metrics__card", "data-digest": digest.slice(0, 8) },
    h("h4", { class: "version-metrics__version" }, versionLabel(detail, digest, true)),
    metrics.sessionsTotal === 0
      ? h("p", { class: "note" }, "기간 내 이 버전을 읽은 세션이 없습니다.")
      : allFailed
        ? h("p", { class: "note" }, `세션 기록을 조회하지 못해 읽기 요청을 집계하지 못했습니다. 조회 실패 ${metrics.sessionsExcluded}개입니다.`)
        : h("div", null,
          h("p", { class: "version-metrics__count" }, `읽기 요청 ${metrics.loadTotal}건`),
          metrics.loadTotal === 0
            ? h("p", { class: "note" }, "집계한 세션에서 이 버전의 읽기 요청이 확인되지 않았습니다.")
            : h("p", { class: "version-metrics__statuses" }, statusLine(metrics)),
          h("p", { class: "note version-metrics__sample" }, sampleNote({
            sources: metrics.sources, fromLabel: kstDay(from), toLabel: kstDay(to),
            sessionsTotal: metrics.sessionsTotal, sessionsSampled: metrics.sessionsSampled,
            sessionsExcluded: metrics.sessionsExcluded,
          })),
          h("table", { class: "version-metrics__table" },
            h("thead", null, h("tr", null,
              h("th", { scope: "col" }, "시작 KST"), h("th", { scope: "col" }, "실행 환경"),
              h("th", { scope: "col" }, "첫 프롬프트"), h("th", { scope: "col" }, "읽기"))),
            h("tbody", null, metrics.sessions.map(session => h("tr", { key: session.key },
              h("td", null, kstDateTime(session.startedAt)),
              h("td", null, session.runtime),
              h("td", { class: "version-metrics__prompt" }, session.firstPrompt === null ? "—" :
                session.firstPrompt.length > 40 ? `${session.firstPrompt.slice(0, 40)}…` : session.firstPrompt),
              h("td", null, session.loadCount === null ? "조회 실패" : `${session.loadCount}`)))))));
}

/** J3: per-version read metrics for the two versions selected in the compare tab. */
export function VersionMetricsPanel({ detail, before, after, signal, onUnauthorized, active = true }: Props) {
  const [period, setPeriod] = useState<number>(30);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<MetricsState>({ kind: "idle" });
  useEffect(() => {
    if (!active) return;
    let live = true;
    setState({ kind: "loading" });
    const to = Date.now();
    const from = to - period * 24 * 3600000;
    const run = async () => {
      const data = await readProfiles(signal);
      const ready = data.profiles.filter(profile => profile.availability === "ready");
      if (!live) return;
      if (ready.length === 0) { setState({ kind: "no-sources" }); return; }
      const beforeMetrics = await readVersionMetrics(ready, detail.skill.skillId, before, from, to, signal);
      const afterMetrics = after === before ? null :
        await readVersionMetrics(ready, detail.skill.skillId, after, from, to, signal);
      if (!live) return;
      setState({ kind: "ready", from, to, before: beforeMetrics, after: afterMetrics });
    };
    run().catch((error: unknown) => {
      if (!live || (error instanceof DOMException && error.name === "AbortError")) return;
      if (isUnauthorized(error) || isMetricsUnauthorized(error)) { onUnauthorized(); return; }
      setState({ kind: "failed", message: failureMessage(error),
        technical: error instanceof Error ? error.message : null });
    });
    return () => { live = false; };
  }, [active, before, after, period, retry, detail.skill.skillId]);
  if (!active) return null;
  return h("section", { class: "version-metrics", "aria-labelledby": "version-metrics-title" },
    h("h3", { id: "version-metrics-title", class: "panel__subtitle" }, "버전별 읽기 지표"),
    h("p", { class: "note" }, "선택한 두 버전에 같은 기간을 적용합니다. 호스팅 연결을 통해 기록된 읽기 요청만 집계하며, 성공률은 계산하지 않습니다. 날짜는 KST입니다."),
    h("div", { class: "version-metrics__period", role: "group", "aria-label": "집계 기간" },
      VERSION_METRICS_PERIODS.map(days => h("button", {
        key: days, type: "button",
        class: `button ${period === days ? "primary" : "secondary"}`,
        "aria-pressed": period === days,
        onClick: () => setPeriod(days),
      }, `최근 ${days}일`))),
    state.kind === "loading" && h("p", { class: "note", role: "status" }, "버전별 읽기 지표를 집계하는 중…"),
    state.kind === "no-sources" &&
      h("p", { class: "note" }, "조회 가능한 활동 출처가 없습니다. 대시보드에서 기기 연결과 기록 동의가 끝난 뒤에 표시됩니다."),
    state.kind === "failed" && h("div", null,
      h("p", { class: "note", role: "status" }, state.message),
      h("button", { class: "button secondary", type: "button", onClick: () => setRetry(value => value + 1) }, "다시 시도"),
      state.technical !== null && h("details", { class: "technical" }, h("summary", null, "기술 정보"), h("code", null, state.technical))),
    state.kind === "ready" && h("div", { class: "version-metrics__grid" },
      h(MetricsCard, { detail, digest: before, metrics: state.before, from: state.from, to: state.to }),
      state.after !== null
        ? h(MetricsCard, { detail, digest: after, metrics: state.after, from: state.from, to: state.to })
        : h("p", { class: "note" }, "같은 버전을 두 번 골랐습니다. 비교할 다른 버전이 아직 없습니다.")));
}
