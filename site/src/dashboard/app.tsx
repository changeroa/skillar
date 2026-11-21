import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardProfile, DashboardProfiles, DashboardReportStatus } from "../../../shared/dist/activity-dashboard.js";
import { configureApi } from "../../../local/dashboard/api";
import { createCloudApi } from "../../../local/dashboard/cloud";
import type { CloudApi } from "../../../local/dashboard/cloud";
import { App as LocalViews } from "../../../local/dashboard/main";
import { UploadOffEmpty } from "../../../local/dashboard/views/sessions";
import { configureHostedSources } from "../../../local/dashboard/views/hosted-sessions";
import type { SessionUser } from "../../lib/account.ts";
import { describeFailure, failureOf, isUnauthorized, readProfiles, readSession } from "./api";
import type { SessionState } from "./api";
import { CommandsDisclosure } from "./commands-panel";
import { PrivatePacks } from "./packs";
import { DevicesSection } from "./devices";
import { SnapshotSection, SourcesSection } from "./sources";
import { HomeChecklist } from "./home-checklist";
import { SkillsEmpty } from "./skills-empty";
import { loadDevices } from "./devices";
import { devicesSettledForAutoSelect, mergeReports, profileKey, shortId } from "./status";
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
  if (phase.kind === "signed-out") {
    // /sessions/ 해시 라우트(#/sessions 등)까지 보존해 로그인 뒤 같은 뷰로 돌아온다.
    location.replace(`/login/?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
    return null;
  }
  const text = phase.kind === "expired" ? "세션이 끝나 이 페이지의 활동 내용을 지웠습니다. 계속하려면 다시 로그인하세요." :
    phase.kind === "unreachable" ? "계정 서비스에 연결할 수 없습니다. 연결 상태를 확인하고 페이지를 새로 고치세요." :
    "계정 서비스의 응답 형식 오류입니다. 페이지를 새로 고쳐 다시 시도하세요.";
  return (
    <div className="auth-actions dash-signed-out">
      <p className="note session-status" role="status" aria-live="polite">{text}</p>
      <a className="button primary" href="/auth/google">Google로 계속하기 <span aria-hidden="true">{"\u2192"}</span></a>
    </div>
  );
}

type SignedInProps = {
  readonly user: SessionUser;
  readonly signal: AbortSignal;
  readonly selected: DashboardProfile | null;
  readonly report: DashboardReportStatus | null;
  readonly failure: RequestFailure | null;
  readonly onSelect: (profile: DashboardProfile, deviceLabel: string | null) => void;
  readonly onClose: () => void;
  readonly onRebuild: () => void;
  readonly onUnauthorized: () => void;
  // 보여 줄 출처가 하나도 없을 때의 빈 상태: /dashboard/는 빈 스킬 뷰(기존 오너 결정),
  // 독립 /sessions/는 세션 화면의 "업로드 꺼짐 · 켜기" 한 줄(코어-미니멈 A).
  readonly emptyView?: "skills" | "sessions";
};

function SignedIn({ user, signal, selected, report, failure, onSelect, onClose, onRebuild, onUnauthorized, emptyView = "skills" }: SignedInProps) {
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
  const needsSourceGuidance = profiles.status !== "ready" || !hasViewableSources;
  useEffect(() => {
    if (selected === null || profiles.status !== "ready") return;
    const key = profileKey(selected);
    if (!list.some(profile => profileKey(profile) === key && profile.availability === "ready")) onClose();
  }, [profiles]);
  // 살아 있는(연결 해제되지 않은) 출처가 정확히 하나뿐이면 선택지가 없으므로 자동으로 연다.
  // 사용자가 닫은 출처는 dismissed에 남겨 다시 자동으로 열지 않는다.
  const dismissedAutoSelect = useRef<string | null>(null);
  const autoSelectedKey = useRef<string | null>(null);
  useEffect(() => {
    if (profiles.status !== "ready" || !devicesSettledForAutoSelect(emptyView, devices.status) || selected !== null) return;
    // 출처 전체 보기가 기본이라 선택 단계가 없다: 보기 가능한 출처가 있으면 첫 출처를 리포트(본문·스킬 화면) 기준으로 연다.
    // 스킬 화면은 기존대로 출처가 하나뿐일 때만 자동으로 연다. 세션 화면만 출처 전체 보기라 첫 출처를 연다.
    const live = emptyView === "sessions" ? list.filter(profile => profile.availability === "ready") : list.filter(profile => profile.availability !== "revoked");
    if (emptyView === "sessions" ? live.length === 0 : live.length !== 1 || live[0].availability !== "ready") return;
    const key = profileKey(live[0]);
    if (autoSelectedKey.current === key || dismissedAutoSelect.current === key) return;
    autoSelectedKey.current = key;
    onSelect(live[0], devices.data?.find(device => device.deviceId === live[0].deviceId)?.label ?? null);
  }, [profiles, devices, selected]);
  // 세션 목록은 보기 가능한 모든 출처를 합쳐 읽는다(출처 전체 기본). 출처마다 라이브 연결 없는 읽기 전용 어댑터를 둔다.
  // 기기 이름이 늦게 도착해도 출처 등록은 이름이 바뀔 때만 다시 한다(이름 없이도 목록은 먼저 열린다).
  const deviceLabelsKey = list.filter(profile => profile.availability === "ready").map(profile => devices.data?.find(device => device.deviceId === profile.deviceId)?.label ?? "").join("\n");
  const readyKeys = list.filter(profile => profile.availability === "ready").map(profileKey).join("\n");
  useEffect(() => {
    if (emptyView !== "sessions" || profiles.status !== "ready") return;
    const ready = list.filter(profile => profile.availability === "ready");
    if (ready.length === 0) { configureHostedSources(undefined); return; }
    const apis = ready.map(profile => {
      const label = devices.data?.find(device => device.deviceId === profile.deviceId)?.label ?? null;
      const key = `${profile.deviceId}:${profile.sourceDomain}`.replaceAll("/", "_");
      return { profile, key, label: label ?? `기기 ${shortId(profile.deviceId)} · ${shortId(profile.sourceDomain)}`,
        api: createCloudApi({ deviceId: profile.deviceId, sourceDomain: profile.sourceDomain, label }, { signal, onUnauthorized }) };
    });
    configureHostedSources({
      sources: apis.map(item => ({ key: item.key, label: item.label, index: item.api.sessionIndex })),
      lastReceivedMs: ready.reduce<number | null>((latest, profile) => profile.receivedAtMs === null ? latest : Math.max(latest ?? 0, profile.receivedAtMs), null),
      select: key => {
        const item = apis.find(entry => entry.key === key);
        if (item !== undefined) onSelect(item.profile, devices.data?.find(device => device.deviceId === item.profile.deviceId)?.label ?? null);
      },
    });
    return () => { configureHostedSources(undefined); for (const item of apis) item.api.dispose(); };
  }, [emptyView, profiles.status, readyKeys, deviceLabelsKey]);
  const allSources = emptyView === "sessions" && hasViewableSources; // 세션 화면: 출처 전체 보기(출처 선택 단계 없음)
  const openingSessions = emptyView === "sessions" && profiles.status === "ready" && hasViewableSources && dismissedAutoSelect.current === null;
  const readyList = list.filter(profile => profile.availability === "ready");
  const lastReceived = readyList.reduce<number | null>((latest, profile) => profile.receivedAtMs === null ? latest : Math.max(latest ?? 0, profile.receivedAtMs), null);
  const current = selected === null ? null : list.find(profile => profileKey(profile) === profileKey(selected)) ?? selected;
  const closeRecord = () => {
    dismissedAutoSelect.current = selected === null ? dismissedAutoSelect.current : profileKey(selected);
    onClose();
    if (sourcePicker.current) {
      sourcePicker.current.open = true;
      sourceSummary.current?.focus();
    }
  };
  const loadMessage = (state: Loaded<unknown>, loading: string): string =>
    state.status === "loading" ? loading : state.message;
  // 출처 없음 온보딩은 삭제됐다(오너 ts 1795051070.800359): 빈 스킬 뷰가 그 자리에 선다.
  const checklist = profiles.status === "ready" && !hasViewableSources
    ? (emptyView === "sessions" ? <UploadOffEmpty /> : <SkillsEmpty />) : <HomeChecklist
    state={profiles.status === "ready" ? "choose" : profiles.status}
    message={profiles.message} technical={profiles.technical} onRetry={reload}
    stale={hasViewableSources} />;
  return (
    <>
      {!allSources && <div className="dash-account">
        <div className="account-user">
          <div>
            <p className="note">로그인 계정</p>
            <p className="account-name">{user.name === "" ? user.email : user.name}</p>
            {user.name !== "" && <p className="account-email">{user.email}</p>}
          </div>
        </div>
        <form method="post" action="/auth/logout"><button className="button secondary" type="submit">로그아웃</button></form>
      </div>}
      <div className={`dash-workspace${hasViewableSources && !allSources ? "" : " dash-workspace--no-sources"}${allSources ? " dash-workspace--tight" : ""}`}>
        {selected !== null && profiles.status !== "ready" && <div className="dash-refresh">{checklist}</div>}
        {hasViewableSources && !allSources && <aside className="dash-sources" aria-label="활동 출처">
          <details ref={sourcePicker} className="dash-source-picker">
            <summary ref={sourceSummary}>{selected === null ? "출처 선택" : <>출처 변경 및 상세 <code title={selected.sourceDomain}>{shortId(selected.sourceDomain)}</code></>}</summary>
            <SourcesSection profiles={list} selectedKey={selected === null ? null : profileKey(selected)} busy={profiles.status === "loading"}
              message={loadMessage(profiles, "출처를 읽는 중\u2026")} onSelect={profile => {
                if (sourcePicker.current) sourcePicker.current.open = false;
                onSelect(profile, devices.data?.find(device => device.deviceId === profile.deviceId)?.label ?? null);
              }} onReload={reload} />
          </details>
        </aside>}
        <div className="dash-activity">
          {/* 세션 화면은 출처가 보이면 자동으로 연다. 그 사이에 예전 "출처를 선택하세요" 화면을 보이지 않고 로딩으로 둔다.
              사용자가 닫은 뒤(dismissed)에는 직접 고르도록 선택 화면을 둔다. */}
          {selected === null && openingSessions && <p className="note session-status" role="status" aria-live="polite">세션을 여는 중{"\u2026"}</p>}
          {selected === null && !openingSessions && needsSourceGuidance && checklist}
          {selected === null && !openingSessions && !needsSourceGuidance && checklist}
          {allSources && selected !== null && current !== null && (
            <section className="panel snapshot" aria-label="세션 기록">
              <div className="dash-embed"><LocalViews key={profileKey(selected)} embedded /></div>
            </section>
          )}
          {!allSources && selected !== null && current !== null && (
            <SnapshotSection profile={current} report={report} failure={failure} onRebuild={onRebuild} onClose={closeRecord}
              commands={
                <CommandsDisclosure key={profileKey(selected)} profile={current} sourcesBusy={profiles.status === "loading"} sourcesLoad={sourcesLoad}
                  signal={signal} onRefreshSources={reloadProfiles} onUnauthorized={onUnauthorized} />
              }>
              <LocalViews key={profileKey(selected)} embedded />
            </SnapshotSection>
          )}
        </div>
      </div>
      <details ref={management} id="dashboard-management" className="dash-management">
        <summary>기기 및 비공개 팩 관리</summary>
        {allSources && <>
          <SourcesSection profiles={list} selectedKey={selected === null ? null : profileKey(selected)} busy={profiles.status === "loading"}
            message={loadMessage(profiles, "출처를 읽는 중\u2026")} onSelect={profile => onSelect(profile, devices.data?.find(device => device.deviceId === profile.deviceId)?.label ?? null)} onReload={reload} />
          {selected !== null && current !== null && (
            <SnapshotSection profile={current} report={report} failure={failure} onRebuild={onRebuild} onClose={closeRecord}
              commands={<CommandsDisclosure key={profileKey(selected)} profile={current} sourcesBusy={profiles.status === "loading"} sourcesLoad={sourcesLoad}
                signal={signal} onRefreshSources={reloadProfiles} onUnauthorized={onUnauthorized} />}>{null}</SnapshotSection>
          )}
        </>}
        <DevicesSection devices={devices.data ?? []} origin={location.origin} ingestEnabled={profiles.data?.ingestEnabled ?? true}
          settled={devices.status === "ready"} message={loadMessage(devices, "기기를 읽는 중\u2026")}
          signal={signal} onChanged={reload} onUnauthorized={onUnauthorized} />
        <PrivatePacks key={user.email} signal={signal} onUnauthorized={onUnauthorized} />
      </details>
    </>
  );
}

export function Dashboard({ signal, emptyView = "skills" }: { readonly signal: AbortSignal; readonly emptyView?: "skills" | "sessions" }) {
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
  // The breadcrumb source switcher only makes sense signed in: signed out
  // there is no source to switch to.
  useEffect(() => {
    const switcher = document.querySelector<HTMLElement>(".app-breadcrumb details");
    if (switcher) switcher.hidden = phase.kind !== "signed-in";
  }, [phase.kind]);
  useEffect(() => {
    readSession(signal).then(setPhase, (error: unknown) => {
      if (!isAbort(error)) setPhase({ kind: "unexpected" });
    });
  }, [signal]);
  useEffect(() => () => {
    cloud.current?.dispose();
    cloud.current = null;
  }, []);
  const select = (profile: DashboardProfile, deviceLabel: string | null = null) => {
    if (selected !== null && profileKey(selected) === profileKey(profile)) return;
    close();
    let sequence = 0;
    const runs = new Map<string, number>();
    const requests = new Map<string, number>();
    const jobs = new Map<string, { readonly key: string; readonly run: number; readonly epoch: number }>();
    // 기기 이름(label)이 /api/devices에 있으면 세션 화면의 기기 열에 실어 보낸다(C). 없으면 미제공 표시로 떨어진다.
    const api = createCloudApi({ deviceId: profile.deviceId, sourceDomain: profile.sourceDomain, label: deviceLabel }, {
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
  if (phase.kind === "checking") return <p className="note session-status" role="status" aria-live="polite">계정을 확인하는 중{"\u2026"}</p>;
  if (phase.kind !== "signed-in") return <SignedOut phase={phase} />;
  return (
    <SignedIn user={phase.user} signal={signal} selected={selected} report={mergeReports(reports.values())} failure={failures.values().next().value ?? null} onSelect={select}
      onClose={close} onUnauthorized={expire} emptyView={emptyView}
      onRebuild={() => {
        failureEpoch.current += 1;
        setReports(new Map());
        setFailures(new Map());
        cloud.current?.refresh();
      }} />
  );
}
