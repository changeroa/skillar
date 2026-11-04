import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { z } from "zod";
import type { DashboardProfile, DashboardProfiles, DashboardReportStatus } from "../../../shared/dist/activity-dashboard.js";
import type { Consent } from "../../../shared/dist/activity-consent.js";
import { configureApi } from "../../../local/dashboard/api";
import { createCloudApi } from "../../../local/dashboard/cloud";
import type { CloudApi } from "../../../local/dashboard/cloud";
import { App as LocalViews } from "../../../local/dashboard/main";
import type { SessionUser } from "../../lib/account.ts";
import { describeFailure, isUnauthorized, readConsent, readDevices, readProfiles, readSession } from "./api";
import type { SessionState } from "./api";
import { CommandsDisclosure } from "./commands-panel";
import { PrivatePacks } from "./packs";
import { DevicesSection } from "./devices";
import type { DeviceState } from "./devices";
import { SnapshotSection, SourcesSection } from "./sources";
import { mergeReports, profileKey } from "./status";
import type { RequestFailure } from "./status";

type Loaded<T> = {
  readonly status: "loading" | "ready" | "failed"; readonly data: T | null;
  readonly message: string; readonly completedLoads: number;
};
type Phase = SessionState | { readonly kind: "checking" } | { readonly kind: "expired" };
const LOCAL_ONLY: Consent = { mode: "local-only" };
const errorCodeSchema = z.object({ error: z.string().min(1).max(100) });

async function failureOf(response: Response): Promise<RequestFailure> {
  let code = `http_${response.status}`;
  try {
    const parsed = errorCodeSchema.safeParse(await response.clone().json());
    if (parsed.success) code = parsed.data.error;
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error;
  }
  return { status: response.status, code };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function loadDevices(signal: AbortSignal): Promise<readonly DeviceState[]> {
  const devices = await readDevices(signal);
  const states = await Promise.all(devices.map(async (device): Promise<DeviceState> => {
    if (device.revokedAt !== null) return { ...device, version: 0, consent: LOCAL_ONLY };
    const state = await readConsent(device.deviceId, signal);
    return { ...device, version: state.version, consent: state.consent };
  }));
  return states.sort((a, b) => b.createdAt - a.createdAt);
}

function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>, action: string, signal: AbortSignal, onUnauthorized: () => void,
): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ status: "loading", data: null, message: "", completedLoads: 0 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setState(current => ({ ...current, status: "loading", message: "" }));
    load(signal).then(data => {
      if (active) setState(current => ({ status: "ready", data, message: "", completedLoads: current.completedLoads + 1 }));
    }, (error: unknown) => {
      if (!active || isAbort(error)) return;
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setState(current => ({ ...current, status: "failed", message: describeFailure(error, action) }));
    });
    return () => { active = false; };
  }, [tick, signal]);
  return [state, () => setTick(current => current + 1)];
}

function SignedOut({ phase }: { readonly phase: Exclude<Phase, { kind: "signed-in" | "checking" }> }) {
  const text = phase.kind === "expired" ? "Your session ended, so activity was cleared from this page. Sign in again to continue." :
    phase.kind === "signed-out" ? "Not signed in. Activity is shown only after you sign in." :
    phase.kind === "unreachable" ? "Couldn't reach the account service. Check your connection and reload." :
    "The account service didn't answer as expected. Try again later.";
  return (
    <div class="auth-actions dash-signed-out">
      <p class="note session-status" role="status" aria-live="polite">{text}</p>
      <a class="button primary" href="/auth/google">Continue with Google <span aria-hidden="true">{"\u2192"}</span></a>
      <p class="note">Google asks for your consent on its own page. skillar then stores your Google ID, email, name, picture, and your first and latest sign-in times. Your session is a signed, secure cookie. Google tokens aren't retained.</p>
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
  const [profiles, reloadProfiles] = useLoad<DashboardProfiles>(readProfiles, "Loading sources", signal, onUnauthorized);
  const [devices, reloadDevices] = useLoad(loadDevices, "Loading devices", signal, onUnauthorized);
  const reload = () => {
    reloadProfiles();
    reloadDevices();
  };
  const list = profiles.data?.profiles ?? [];
  const sourcesLoad = profiles.completedLoads;
  useEffect(() => {
    if (selected === null || profiles.status !== "ready") return;
    const key = profileKey(selected);
    if (!list.some(profile => profileKey(profile) === key && profile.availability === "ready")) onClose();
  }, [profiles]);
  const current = selected === null ? null : list.find(profile => profileKey(profile) === profileKey(selected)) ?? selected;
  const loadMessage = (state: Loaded<unknown>, loading: string): string =>
    state.status === "loading" ? loading : state.message;
  return (
    <>
      <div class="dash-account">
        <div class="account-user">
          <div>
            <p class="note">Signed in as</p>
            <p class="account-name">{user.name === "" ? user.email : user.name}</p>
            {user.name !== "" && <p class="account-email">{user.email}</p>}
          </div>
        </div>
        <form method="post" action="/auth/logout"><button class="button secondary" type="submit">Sign out</button></form>
      </div>
      <div class="dash-workspace">
        <aside class="dash-sources" aria-label="활동 출처">
          {selected !== null && <p class="dash-source-current">출처 <code>{selected.sourceDomain}</code></p>}
          <details ref={sourcePicker} class="dash-source-picker" open={selected === null}>
            <summary>{selected === null ? "출처 선택" : "출처 변경 및 상세"}</summary>
            <SourcesSection profiles={list} selectedKey={selected === null ? null : profileKey(selected)} busy={profiles.status === "loading"}
              message={loadMessage(profiles, "Loading sources\u2026")} onSelect={profile => {
                if (sourcePicker.current) sourcePicker.current.open = false;
                onSelect(profile);
              }} onReload={reload} />
          </details>
        </aside>
        <div class="dash-activity">
          {selected !== null && current !== null ? (
            <SnapshotSection profile={selected} report={report} failure={failure} onRebuild={onRebuild} onClose={onClose}
              commands={
                <CommandsDisclosure key={profileKey(selected)} profile={current} sourcesBusy={profiles.status === "loading"} sourcesLoad={sourcesLoad}
                  signal={signal} onRefreshSources={reloadProfiles} onUnauthorized={onUnauthorized} />
              }>
              <LocalViews key={profileKey(selected)} embedded />
            </SnapshotSection>
          ) : (
            <section class="dash-empty" aria-labelledby="dash-empty-title">
              <h2 id="dash-empty-title">확인할 출처를 선택하세요</h2>
              <p>조회할 수 있는 출처에서 Show snapshot을 선택하면 세션과 검색·읽기 기록이 열립니다.</p>
              <p class="note">아직 기록을 선택하지 않았습니다. 읽기 기록은 작업 성공을 뜻하지 않습니다.</p>
            </section>
          )}
        </div>
      </div>
      <details class="dash-management">
        <summary>기기 및 private pack 관리</summary>
        <DevicesSection devices={devices.data ?? []} origin={location.origin} ingestEnabled={profiles.data?.ingestEnabled ?? true}
          settled={devices.status === "ready"} message={loadMessage(devices, "Loading devices\u2026")}
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
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const cloud = useRef<CloudApi | null>(null);
  const close = useCallback(() => {
    cloud.current?.dispose();
    cloud.current = null;
    setSelected(null);
    setReports(new Map());
    setFailure(null);
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
    const api = createCloudApi({ deviceId: profile.deviceId, sourceDomain: profile.sourceDomain }, {
      signal, onUnauthorized: expire, live: {},
      onReport: status => setReports(current => new Map(current).set(status.jobId, status)),
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (!response.ok && response.status !== 401) setFailure(await failureOf(response));
        return response;
      },
    });
    cloud.current = api;
    configureApi(api);
    setSelected(profile);
  };
  if (phase.kind === "checking") return <p class="note session-status" role="status" aria-live="polite">Checking your account{"\u2026"}</p>;
  if (phase.kind !== "signed-in") return <SignedOut phase={phase} />;
  return (
    <SignedIn user={phase.user} signal={signal} selected={selected} report={mergeReports(reports.values())} failure={failure} onSelect={select}
      onClose={close} onUnauthorized={expire}
      onRebuild={() => {
        setReports(new Map());
        setFailure(null);
        cloud.current?.refresh();
      }} />
  );
}
