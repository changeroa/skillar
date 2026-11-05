import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { DashboardProfile, DashboardProfiles, DashboardReportStatus } from "../../../shared/dist/activity-dashboard.js";
import { configureApi } from "../../../local/dashboard/api";
import { createCloudApi } from "../../../local/dashboard/cloud";
import type { CloudApi } from "../../../local/dashboard/cloud";
import { App as LocalViews } from "../../../local/dashboard/main";
import type { SessionUser } from "../../lib/account.ts";
import { describeFailure, failureOf, isUnauthorized, readProfiles, readSession } from "./api";
import type { SessionState } from "./api";
import { CommandsDisclosure } from "./commands-panel";
import { PrivatePacks } from "./packs";
import { DevicesSection } from "./devices";
import { SnapshotSection, SourcesSection } from "./sources";
import { HomeChecklist } from "./home-checklist";
import { HomeWidgets } from "./home-widgets";
import { loadDevices, PermissionSummary } from "./permission-summary";
import { mergeReports, profileKey, shortId } from "./status";
import type { RequestFailure } from "./status";
import { dashboardPaths, dashboardQuerySchema, dashboardReferenceSchema, dashboardReportStatusSchema, dashboardResultPartRequestSchema } from "../../../shared/dist/activity-dashboard.js";

type Loaded<T> = {
  readonly status: "loading" | "ready" | "failed"; readonly data: T | null;
  readonly message: string; readonly technical: string; readonly completedLoads: number;
};
type Phase = SessionState | { readonly kind: "checking" } | { readonly kind: "expired" };
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>, action: string, signal: AbortSignal, onUnauthorized: () => void,
): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ status: "loading", data: null, message: "", technical: "", completedLoads: 0 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setState(current => ({ ...current, status: "loading", message: "", technical: "" }));
    load(signal).then(data => {
      if (active) setState(current => ({ status: "ready", data, message: "", technical: "", completedLoads: current.completedLoads + 1 }));
    }, (error: unknown) => {
      if (!active || isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setState(current => ({ ...current, status: "failed", message: describeFailure(error, action),
        technical: error instanceof Error ? error.message : "" }));
    });
    return () => { active = false; };
  }, [tick, signal]);
  return [state, () => setTick(current => current + 1)];
}

function SignedOut({ phase }: { readonly phase: Exclude<Phase, { kind: "signed-in" | "checking" }> }) {
  const text = phase.kind === "expired" ? "세션이 끝나 이 페이지의 활동 내용을 지웠습니다. 계속하려면 다시 로그인하세요." :
    phase.kind === "signed-out" ? "로그인되어 있지 않습니다. 활동은 로그인한 뒤에만 표시됩니다." :
    phase.kind === "unreachable" ? "계정 서비스에 연결할 수 없습니다. 연결 상태를 확인하고 페이지를 새로 고치세요." :
    "계정 서비스의 응답 형식 오류입니다. 페이지를 새로 고쳐 다시 시도하세요.";
  return (
    <div class="auth-actions dash-signed-out">
      <p class="note session-status" role="status" aria-live="polite">{text}</p>
      <a class="button primary" href="/auth/google">Google로 계속하기 <span aria-hidden="true">{"\u2192"}</span></a>
      <p class="note">Google은 자체 페이지에서 동의를 요청합니다. 그 뒤 skillar는 Google ID, 이메일, 이름, 프로필 사진, 첫 로그인 시각과 최근 로그인 시각을 저장합니다. 세션은 서명된 보안 쿠키이며, Google 토큰은 보관하지 않습니다.</p>
    </div>
  );
}

type SignedInProps = {
  readonly user: SessionUser;
  readonly signal: AbortSignal;
  readonly selected: DashboardProfile | null;
  readonly report: DashboardReportStatus | null;
  readonly failure: RequestFailure | null;
  readonly onSelect: (profile: DashboardProfile) => void;
  readonly onClose: () => void;
  readonly onRebuild: () => void;
  readonly onUnauthorized: () => void;
};

function SignedIn({ user, signal, selected, report, failure, onSelect, onClose, onRebuild, onUnauthorized }: SignedInProps) {
  const sourcePicker = useRef<HTMLDetailsElement>(null);
  const sourceSummary = useRef<HTMLElement>(null);
  const management = useRef<HTMLDetailsElement>(null);
  const [profiles, reloadProfiles] = useLoad<DashboardProfiles>(readProfiles, "출처 읽기", signal, onUnauthorized);
  const [devices, reloadDevices] = useLoad(loadDevices, "기기 읽기", signal, onUnauthorized);
  const reload = () => {
    reloadProfiles();
    reloadDevices();
  };
  const list = profiles.data?.profiles ?? [];
  const hasViewableSources = list.some(profile => profile.availability === "ready");
  const sourcesLoad = profiles.completedLoads;
  useEffect(() => {
    if (selected === null || profiles.status !== "ready") return;
    const key = profileKey(selected);
    if (!list.some(profile => profileKey(profile) === key && profile.availability === "ready")) onClose();
  }, [profiles]);
  const current = selected === null ? null : list.find(profile => profileKey(profile) === profileKey(selected)) ?? selected;
  const closeRecord = () => {
    onClose();
    if (sourcePicker.current) {
      sourcePicker.current.open = true;
      sourceSummary.current?.focus();
    }
  };
  const loadMessage = (state: Loaded<unknown>, loading: string): string =>
    state.status === "loading" ? loading : state.message;
  const checklist = <HomeChecklist
    state={profiles.status === "ready" ? hasViewableSources ? "choose" : "none" : profiles.status}
    message={profiles.message} technical={profiles.technical} profiles={list} devices={devices} onRetry={reload}
    stale={hasViewableSources} onManage={() => { if (management.current) management.current.open = true; }} />;
  return (
    <>
      <div class={`dash-workspace${hasViewableSources ? "" : " dash-workspace--no-sources"}`}>
        {selected !== null && profiles.status !== "ready" && <div class="dash-refresh">{checklist}</div>}
        {hasViewableSources && <aside class="dash-sources" aria-label="활동 출처">
          <details ref={sourcePicker} class="dash-source-picker">
            <summary ref={sourceSummary}>{selected === null ? "출처 선택" : <>출처 변경 및 상세 <code title={selected.sourceDomain}>{shortId(selected.sourceDomain)}</code></>}</summary>
            <SourcesSection profiles={list} selectedKey={selected === null ? null : profileKey(selected)} busy={profiles.status === "loading"}
              message={loadMessage(profiles, "출처를 읽는 중\u2026")} onSelect={profile => {
                if (sourcePicker.current) sourcePicker.current.open = false;
                onSelect(profile);
              }} onReload={reload} />
          </details>
        </aside>}
        <div class="dash-activity">
          {selected === null && <HomeWidgets signal={signal} devices={devices} onRetryDevices={reloadDevices} onUnauthorized={onUnauthorized} />}
          {selected === null && checklist}
          {selected !== null && current !== null && (
            <SnapshotSection profile={current} report={report} failure={failure} onRebuild={onRebuild} onClose={closeRecord}
              commands={
                <CommandsDisclosure key={profileKey(selected)} profile={current} sourcesBusy={profiles.status === "loading"} sourcesLoad={sourcesLoad}
                  signal={signal} onRefreshSources={reloadProfiles} onUnauthorized={onUnauthorized} />
              }>
              <h2 id="dash-data-title">세션</h2><LocalViews key={profileKey(selected)} embedded />
            </SnapshotSection>
          )}
        </div>
      </div>
      <PermissionSummary devices={devices} onRetry={reloadDevices} />
      <details ref={management} id="dashboard-management" class="dash-management">
        <summary>기기 및 비공개 팩 관리</summary>
        <DevicesSection devices={devices.data ?? []} origin={location.origin} ingestEnabled={profiles.data?.ingestEnabled ?? true}
          settled={devices.status === "ready"} message={loadMessage(devices, "기기를 읽는 중\u2026")}
          signal={signal} onChanged={reload} onUnauthorized={onUnauthorized} />
        <PrivatePacks key={user.email} signal={signal} onUnauthorized={onUnauthorized} />
      </details>
    </>
  );
}

export function Dashboard({ signal }: { readonly signal: AbortSignal }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [selected, setSelected] = useState<DashboardProfile | null>(null);
  const [reports, setReports] = useState<ReadonlyMap<string, DashboardReportStatus>>(new Map());
  const [failures, setFailures] = useState<ReadonlyMap<string, RequestFailure>>(new Map());
  const cloud = useRef<CloudApi | null>(null);
  const failureEpoch = useRef(0);
  const close = useCallback(() => {
    cloud.current?.dispose();
    cloud.current = null;
    setSelected(null);
    setReports(new Map());
    setFailures(new Map());
  }, []);
  const expire = useCallback(() => {
    close();
    setPhase({ kind: "expired" });
  }, [close]);
  useEffect(() => {
    readSession(signal).then(setPhase, (error: unknown) => {
      if (!isAbort(error)) setPhase({ kind: "unexpected" });
    });
  }, [signal]);
  useEffect(() => () => {
    cloud.current?.dispose();
    cloud.current = null;
  }, []);
  const select = (profile: DashboardProfile) => {
    if (selected !== null && profileKey(selected) === profileKey(profile)) return;
    close();
    let sequence = 0;
    const runs = new Map<string, number>();
    const requests = new Map<string, number>();
    const jobs = new Map<string, { readonly key: string; readonly run: number; readonly epoch: number }>();
    const api = createCloudApi({ deviceId: profile.deviceId, sourceDomain: profile.sourceDomain }, {
      signal, onUnauthorized: expire, live: {},
      onReport: status => setReports(current => new Map(current).set(status.jobId, status)),
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request?.url ?? String(input), location.origin);
        const query = url.pathname === dashboardPaths.query && typeof init?.body === "string"
          ? dashboardQuerySchema.parse(JSON.parse(init.body)) : null;
        const reference = typeof init?.body === "string" &&
          (url.pathname === dashboardPaths.reportStatus || url.pathname === dashboardPaths.reportResult)
          ? (url.pathname === dashboardPaths.reportResult ? dashboardResultPartRequestSchema : dashboardReferenceSchema).parse(JSON.parse(init.body))
          : null;
        const job = reference === null ? undefined : jobs.get(reference.jobId);
        const key = query === null ? job?.key ?? JSON.stringify([init?.method ?? request?.method ?? "GET", url.href, init?.body ?? ""])
          : JSON.stringify(["report", query.profile, query.query, query.tz]);
        const id = ++sequence;
        const run = query === null ? job?.run ?? id : id;
        const epoch = query === null ? job?.epoch ?? failureEpoch.current : failureEpoch.current;
        if (query !== null || job === undefined) runs.set(key, run);
        if (runs.get(key) === run && epoch === failureEpoch.current) requests.set(key, id);
        const current = () => cloud.current === api && epoch === failureEpoch.current &&
          runs.get(key) === run && requests.get(key) === id;
        const response = await fetch(input, init);
        if (response.ok && query !== null) {
          const status = dashboardReportStatusSchema.safeParse(await response.clone().json());
          if (status.success && (jobs.get(status.data.jobId)?.run ?? 0) < run) {
            jobs.set(status.data.jobId, { key, run, epoch });
          }
        }
        if (!response.ok && response.status !== 401) {
          const failure = await failureOf(response);
          if (current()) setFailures(previous => new Map(previous).set(key, failure));
        } else if (response.ok && current()) {
          setFailures(current => {
            if (!current.has(key)) return current;
            const next = new Map(current);
            next.delete(key);
            return next;
          });
        }
        return response;
      },
    });
    cloud.current = api;
    configureApi(api);
    setSelected(profile);
  };
  if (phase.kind === "checking") return <p class="note session-status" role="status" aria-live="polite">계정을 확인하는 중{"\u2026"}</p>;
  if (phase.kind !== "signed-in") return <SignedOut phase={phase} />;
  return (
    <SignedIn user={phase.user} signal={signal} selected={selected} report={mergeReports(reports.values())} failure={failures.values().next().value ?? null} onSelect={select}
      onClose={close} onUnauthorized={expire}
      onRebuild={() => {
        failureEpoch.current += 1;
        setReports(new Map());
        setFailures(new Map());
        cloud.current?.refresh();
      }} />
  );
}
