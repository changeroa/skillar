import { useEffect, useRef, useState } from "preact/hooks";
import type { CaptureCheck, CaptureHealth, CaptureProbeReport, CaptureRuntime, CaptureRuntimeHealth } from "../../src/diagnostics/capture.js";
import { api } from "../api";
import { installStyles } from "../charts/sankey";
import { RUNTIME_LABEL } from "../state";

const CAPTURE_CSS = `
.capture { margin-block: var(--s-3); }
.capture > summary { padding: var(--s-3) var(--s-4); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
.capture__body { padding: 0 var(--s-4) var(--s-4); }
.capture__scope, .capture__checks { color: var(--ink-2); font-size: var(--fs-cap); }
.capture__table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: var(--fs-sm); }
.capture__table th, .capture__table td { text-align: left; vertical-align: top; padding: var(--s-2); border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.capture__table th { color: var(--ink-3); font-size: var(--fs-cap); font-weight: 500; }
.capture__table .btn { min-height: 32px; height: auto; }
.capture__checks { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); padding: 0; list-style: none; }
.capture__checks li { display: flex; flex-wrap: wrap; gap: var(--s-1); }
.capture__result { margin-top: var(--s-3); }
@media (max-width: 639.98px) {
  .capture__table thead { display: none; }
  .capture__table, .capture__table tbody { display: block; }
  .capture__table tr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); border-top: 1px solid var(--line); padding-block: var(--s-2); }
  .capture__table td { display: block; border: 0; min-width: 0; }
  .capture__table td::before { content: attr(data-label); display: block; color: var(--ink-3); font-size: var(--fs-cap); }
  .capture__table td:first-child { grid-column: 1 / -1; font-weight: 600; }
}
`;

installStyles("capture-health", CAPTURE_CSS);

const timeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function captureReasonCounts(row: Pick<CaptureRuntimeHealth, "unattributedReasons">): { reason: string; count: number }[] {
  return Object.entries(row.unattributedReasons).filter(([, count]) => count > 0).map(([reason, count]) => ({ reason, count }));
}

function Checks({ checks }: { checks: CaptureCheck[] }) {
  return (
    <ul class="capture__checks">
      {checks.map((check) => (
        <li key={check.stage} data-capture-stage={check.stage} data-status={check.status}>
          <span>{check.stage}</span>
          <strong class={check.status === "failed" ? "is-bad" : undefined}>{check.status.replace("_", " ")}</strong>
          {check.code && <code>{check.code}</code>}
        </li>
      ))}
    </ul>
  );
}

export function CaptureHealthPanel({ revision }: { revision: number }) {
  const [health, setHealth] = useState<CaptureHealth>();
  const [error, setError] = useState<string>();
  const [testError, setTestError] = useState<string>();
  const [running, setRunning] = useState<CaptureRuntime | null>(null);
  const [result, setResult] = useState<CaptureProbeReport>();
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; generation.current += 1; }, []);
  useEffect(() => {
    const request = ++generation.current;
    let cancelled = false;
    api.captureHealth().then((value) => {
      if (!cancelled && generation.current === request) {
        setHealth(value);
        setError(undefined);
      }
    }, (err: unknown) => {
      if (!cancelled && generation.current === request) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [revision, reload]);

  const test = async (runtime: CaptureRuntime) => {
    generation.current += 1;
    setRunning(runtime);
    setResult(undefined);
    setTestError(undefined);
    try {
      const report = await api.testCapture(runtime);
      if (mounted.current) setResult(report);
    } catch (err) {
      if (mounted.current) setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) {
        generation.current += 1;
        setRunning(null);
        setReload((value) => value + 1);
      }
    }
  };

  return (
    <details class="capture card" data-capture-health>
      <summary>Capture health</summary>
      <div class="capture__body">
        <p class="capture__scope">
          All-history capture status, independent of session filters. Tests send a synthetic event through the daemon's
          authenticated HTTP ingest, storage, and session attribution. They do not launch an agent or verify its exporter.
          Test sessions are removed and do not count as usage.
        </p>
        {(testError ?? error) && <p class="notice" role="alert">{testError ?? error}</p>}
        {!health && !error && <p role="status">Reading capture status...</p>}
        {health && (
          <table class="capture__table" aria-label="Runtime capture health">
            <thead><tr><th>Runtime</th><th>Last event</th><th>MCP attribution</th><th>Unattributed reasons</th><th>Daemon test</th></tr></thead>
            <tbody>
              {health.runtimes.map((row) => {
                const reasons = captureReasonCounts(row);
                const runtime = row.runtime === "unknown" ? undefined : row.runtime;
                return (
                  <tr key={row.runtime} data-capture-runtime={row.runtime}>
                    <td data-label="Runtime">{RUNTIME_LABEL[row.runtime]}</td>
                    <td data-label="Last event">{row.lastEventAt === null ? "No events" : <time dateTime={new Date(row.lastEventAt).toISOString()}>{timeFmt.format(row.lastEventAt)}</time>}</td>
                    <td data-label="MCP attribution">{row.mcpAttributionRate === null ? "No MCP data" : `${Math.round(row.mcpAttributionRate * 100)}%`}</td>
                    <td data-label="Unattributed reasons">{reasons.length ? reasons.map(({ reason, count }) => `${reason}: ${count}`).join(", ") : "None"}</td>
                    <td data-label="Daemon test">
                      {runtime && <button type="button" class="btn" disabled={running !== null || api.mode === "fixtures"}
                        data-test-capture={runtime} onClick={() => { void test(runtime); }}>
                        {running === runtime ? "Testing..." : "Test capture"}
                      </button>}
                      {row.lastProbe && <div data-last-probe={row.lastProbe.ok ? "passed" : "failed"}>
                        {row.lastProbe.ok ? "Passed" : "Failed"} {timeFmt.format(row.lastProbe.completedAt)}
                      </div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {result && <div class="capture__result" role="status" data-capture-result={result.ok ? "passed" : "failed"}>
          <strong>{RUNTIME_LABEL[result.runtime]} daemon capture test</strong>
          <Checks checks={result.checks} />
        </div>}
      </div>
    </details>
  );
}
