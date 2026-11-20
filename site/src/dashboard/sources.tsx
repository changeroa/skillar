import type {ReactNode as ComponentChildren} from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { DashboardProfile, DashboardReportStatus } from "../../../shared/dist/activity-dashboard.js";
import { availabilityCopy, formatWhen, profileKey, shortId, snapshotLines } from "./status";
import type { RequestFailure } from "./status";

type SourcesProps = {
  readonly profiles: readonly DashboardProfile[];
  readonly selectedKey: string | null;
  readonly busy: boolean;
  readonly message: string;
  readonly onSelect: (profile: DashboardProfile) => void;
  readonly onReload: () => void;
};

export function SourcesSection({ profiles, selectedKey, busy, message, onSelect, onReload }: SourcesProps) {
  // 연결 해제된 출처는 기록을 볼 수 없어 목록에서 기본 숨긴다. 필요하면 토글로 다시 본다.
  const [showRevoked, setShowRevoked] = useState(false);
  const revoked = profiles.filter(profile => profile.availability === "revoked");
  const visible = showRevoked ? profiles : profiles.filter(profile => profile.availability !== "revoked");
  return (
    <section className="panel" aria-labelledby="sources-title">
      <div className="panel__head">
        <h2 id="sources-title">출처</h2>
        <button className="button secondary" type="button" onClick={onReload} disabled={busy}>출처 다시 읽기</button>
      </div>
      <p className="account-lead">출처는 기기 하나의 로컬 데이터베이스입니다. 가장 최근 업로드가 처리된 출처만 볼 수 있으며, 어느 출처를 볼지는 직접 선택합니다.</p>
      {message !== "" && <p className="note" role="status" aria-live="polite">{message}</p>}
      {profiles.length === 0 && !busy && message === "" && (
        <p>아직 업로드한 출처가 없습니다. 아래에서 기기를 연결하고 동의를 저장하면 출처가 추가됩니다.</p>
      )}
      <ul className="source-list">
        {visible.map(profile => {
          const copy = availabilityCopy(profile.availability);
          const key = profileKey(profile);
          const current = key === selectedKey;
          return (
            <li className="source" key={key} aria-current={current ? "true" : undefined}>
              <div className="source__head">
                <h3>기기 <span className="device-id" title={profile.deviceId}>{shortId(profile.deviceId)}</span></h3>
                <span className="source__state">{copy.label}</span>
              </div>
              <dl className="account-status source__facts">
                <div><dt>출처</dt><dd><code title={profile.sourceDomain}>{shortId(profile.sourceDomain)}</code></dd></div>
                <div><dt>수집</dt><dd className="source__when">{formatWhen(profile.capturedAtMs)}</dd></div>
                <div><dt>수신</dt><dd className="source__when">{formatWhen(profile.receivedAtMs)}</dd></div>
                <div><dt>리비전</dt><dd className="source__revisions">
                  <span>{profile.sourceSequence}</span>
                  <span>/ 저널 {profile.journalThrough}</span>
                  <span>/ 실행 환경 {profile.runtimeSequence ?? "없음"}</span>
                </dd></div>
              </dl>
              <p className="note">{copy.explanation}{copy.next === null ? "" : ` ${copy.next}`}</p>
              {copy.selectable && (
                <button className="button secondary" type="button" aria-pressed={current} onClick={() => onSelect(profile)}>
                  {current ? "이 기록 표시 중" : "기록 보기"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {revoked.length > 0 && (
        <p className="note">
          <button className="button secondary" type="button" onClick={() => setShowRevoked(current => !current)}>
            {showRevoked ? `연결 해제된 출처 ${revoked.length}개 숨기기` : `연결 해제된 출처 ${revoked.length}개 보이기`}
          </button>
        </p>
      )}
    </section>
  );
}

type SnapshotProps = {
  readonly profile: DashboardProfile;
  readonly report: DashboardReportStatus | null;
  readonly failure: RequestFailure | null;
  readonly onRebuild: () => void;
  readonly onClose: () => void;
  readonly commands: ComponentChildren;
  readonly children: ComponentChildren;
};

export function SnapshotSection({ profile, report, failure, onRebuild, onClose, commands, children }: SnapshotProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => heading.current?.focus(), [profileKey(profile)]);
  return (
    <section className="panel snapshot" aria-labelledby="snapshot-title">
      <div className="panel__head">
        <h2 id="snapshot-title" ref={heading} tabIndex={-1}>기기 <span className="device-id">{shortId(profile.deviceId)}</span> 기록</h2>
        <div className="cluster">
          <button className="button secondary" type="button" onClick={onRebuild}>보고서 다시 만들기</button>
          <button className="button secondary" type="button" onClick={onClose}>기록 닫기</button>
        </div>
      </div>
      <p className="note">읽기 기록은 작업 성공을 뜻하지 않습니다.</p>
      <details className="snapshot__inspector">
        <summary>출처 상태 및 원격 작업</summary>
        <p className="note">새 업로드가 도착하면 보고서가 새로 고쳐집니다. 수집 시각과 보고서 시각은 최신 여부를 보여 주며, 실시간 연결이 출처 기기가 실행 중이라는 뜻은 아닙니다.</p>
        <dl className="account-status snapshot__facts" aria-live="polite">
        {snapshotLines(profile, report, failure).map(line => (
          <div key={line.term} {...(line.tone === undefined ? {} : { "data-tone": line.tone })}>
            <dt>{line.term}</dt><dd>{line.detail}{line.technical !== undefined && (
              <details><summary>기술 정보</summary><code>{line.technical}</code></details>
            )}</dd>
          </div>
        ))}
        </dl>
        {commands}
      </details>
      <div className="dash-embed">{children}</div>
    </section>
  );
}
