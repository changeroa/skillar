import assert from "node:assert/strict";
import test from "node:test";
import { consentSchema } from "../../shared/dist/activity-consent.js";
import { contentKinds } from "../../shared/dist/activity-schema.js";
import { GRANT_SCOPES, routes } from "../src/dashboard/api.ts";
import { buildConsent, draftFromConsent, emptyDraft, projectIdFor } from "../src/dashboard/consent.ts";
import { connectSteps, grantFileName, grantFileText } from "../src/dashboard/grant.ts";
import { AVAILABILITY_COPY, mergeReports, snapshotLines } from "../src/dashboard/status.ts";

const now = 1_800_000_000_000;
const deviceId = "device-under-test";
const fullDraft = { ...emptyDraft(), mode: "managed-content", kinds: [...contentKinds], serverProcessing: true };
const profile = {
  deviceId, sourceDomain: "source-a", sourceSequence: 4, journalThrough: 40, runtimeSequence: 2,
  capturedAtMs: now - 5000, receivedAtMs: now - 4000, availability: "ready",
};

test("the default draft is local only with nothing preselected", () => {
  const draft = emptyDraft();
  assert.equal(draft.mode, "local-only");
  assert.deepEqual(draft.kinds, []);
  assert.equal(draft.serverProcessing, false);
  assert.equal(draft.backfill.enabled, false);
  assert.deepEqual([draft.contentDays, draft.projectionDays, draft.backupDays], ["30", "30", "30"]);
  assert.deepEqual(buildConsent(draft, deviceId, 2, now), { ok: true, consent: { mode: "local-only" } });
});

test("a full content consent matches the shared schema, the device scope and the next version", () => {
  const built = buildConsent(fullDraft, deviceId, 3, now);
  assert.equal(built.ok, true);
  assert.deepEqual(consentSchema.parse(built.consent), built.consent);
  assert.equal(built.consent.mode, "managed-content");
  assert.equal(built.consent.version, 4);
  assert.equal(built.consent.grantedAtMs, now);
  assert.equal(built.consent.serverProcessingAcknowledged, true);
  assert.equal(built.consent.externalModelTransfer, false);
  assert.deepEqual(built.consent.contentKinds, contentKinds);
  assert.deepEqual(built.consent.scope, { deviceId, projectIds: [projectIdFor(deviceId)], rootIds: [] });
  assert.deepEqual(built.consent.retention, { contentDays: 30, projectionDays: 30, backupDays: 30 });
  assert.equal(built.consent.backfill, undefined);
});

test("content consent needs at least one category and the processing acknowledgement", () => {
  const built = buildConsent({ ...fullDraft, kinds: [], serverProcessing: false }, deviceId, 0, now);
  assert.equal(built.ok, false);
  assert.equal(built.problems.length, 2);
  const retention = buildConsent({ ...fullDraft, backupDays: "31", contentDays: "0" }, deviceId, 0, now);
  assert.equal(retention.ok, false);
  assert.equal(retention.problems.length, 2);
});

test("a historical snapshot needs identity, cut, version and an ordered range", () => {
  const empty = buildConsent({ ...fullDraft, backfill: { ...fullDraft.backfill, enabled: true } }, deviceId, 0, now);
  assert.equal(empty.ok, false);
  assert.equal(empty.problems.length, 3);
  const backwards = buildConsent({ ...fullDraft, backfill: {
    enabled: true, version: "1", snapshotId: "snap", journalCut: "41", from: "2026-02-01T00:00", to: "2026-01-01T00:00",
  } }, deviceId, 0, now);
  assert.equal(backwards.ok, false);
  assert.equal(backwards.problems.length, 1);
  const built = buildConsent({ ...fullDraft, backfill: {
    enabled: true, version: "2", snapshotId: "snap", journalCut: "41", from: "2026-01-01T00:00", to: "2026-02-01T00:00",
  } }, deviceId, 0, now);
  assert.equal(built.ok, true);
  assert.deepEqual(built.consent.backfill, {
    version: 2, snapshotId: "snap", journalCut: 41,
    range: { fromMs: new Date("2026-01-01T00:00").getTime(), toMs: new Date("2026-02-01T00:00").getTime() },
  });
});

test("a saved consent round-trips through the draft with only version and grant time changing", () => {
  const saved = buildConsent({ ...fullDraft, kinds: ["prompt", "query"], contentDays: "90", backfill: {
    enabled: true, version: "1", snapshotId: "snap", journalCut: "7", from: "2026-01-01T09:30", to: "2026-03-01T09:30",
  } }, deviceId, 1, now).consent;
  const again = buildConsent(draftFromConsent(saved), deviceId, saved.version, now + 1);
  assert.equal(again.ok, true);
  assert.deepEqual(again.consent, { ...saved, version: saved.version + 1, grantedAtMs: now + 1 });
});

test("explicit all-history consent covers the prepared snapshot without date inputs", () => {
  const built = buildConsent({ ...fullDraft, backfill: {
    ...fullDraft.backfill, enabled: true, allHistory: true, snapshotId: "snap", journalCut: "7",
  } }, deviceId, 0, now);
  assert.equal(built.ok, true);
  assert.deepEqual(built.consent.backfill, {
    version: 1, snapshotId: "snap", journalCut: 7,
    range: { fromMs: -8_640_000_000_000_000, toMs: 8_640_000_000_000_000 },
  });
});

test("saved historical consent preserves sub-minute bounds when submitted again", () => {
  const saved = { ...buildConsent(fullDraft, deviceId, 0, now).consent, backfill: {
    version: 1, snapshotId: "snap", journalCut: 7,
    range: { fromMs: Date.UTC(2026, 0, 1, 9, 30, 17, 123), toMs: Date.UTC(2026, 2, 1, 9, 30, 43, 987) },
  } };
  const again = buildConsent(draftFromConsent(saved), deviceId, saved.version, now + 1);
  assert.equal(again.ok, true);
  assert.deepEqual(again.consent.backfill, saved.backfill);
});

test("saved all-history consent retains its range when the form is submitted again", () => {
  const saved = { ...buildConsent(fullDraft, deviceId, 0, now).consent, backfill: {
    version: 1, snapshotId: "snap", journalCut: 7,
    range: { fromMs: -8_640_000_000_000_000, toMs: 8_640_000_000_000_000 },
  } };
  const draft = draftFromConsent(saved);
  assert.equal(draft.backfill.allHistory, true);
  const again = buildConsent(draft, deviceId, 1, now + 1);
  assert.equal(again.ok, true);
  assert.deepEqual(again.consent.backfill, saved.backfill);
});

test("backfill bounds beyond the calendar picker round-trip as exact milliseconds", () => {
  const extreme = { fromMs: 8_000_000_000_000_000, toMs: 8_640_000_000_000_000 };
  const saved = { ...buildConsent(fullDraft, deviceId, 0, now).consent, backfill: { version: 1, snapshotId: "snap", journalCut: 189, range: extreme } };
  const draft = draftFromConsent(saved);
  assert.deepEqual([draft.backfill.from, draft.backfill.to], [String(extreme.fromMs), String(extreme.toMs)]);
  const again = buildConsent(draft, deviceId, saved.version, now);
  assert.equal(again.ok, true);
  assert.deepEqual(again.consent.backfill, saved.backfill);
});

test("grant files are transient downloads with CLI steps that never carry the grant", () => {
  const name = grantFileName("Qx9_-Abc123DEF");
  assert.equal(name, "skillar-grant-qx9abc12.txt");
  assert.equal(grantFileText("the-grant"), "the-grant\n");
  const steps = connectSteps(name, "https://skillar.sh");
  assert.equal(steps[0].command, `skillar sync connect --grant-file ~/Downloads/${name}`);
  assert.equal(connectSteps(name, "http://localhost:8788")[0].command?.endsWith(" --origin http://localhost:8788"), true);
  assert.equal(steps.some(step => step.command?.includes("the-grant")), false);
  assert.deepEqual(GRANT_SCOPES, ["activity:read", "activity:ingest"]);
  assert.equal(routes.grants, "/api/devices/grants");
  assert.equal(routes.consent("a/b"), "/api/devices/a%2Fb/consent");
});

test("only ready sources are selectable and every other state names a next step", () => {
  for (const [availability, copy] of Object.entries(AVAILABILITY_COPY)) {
    assert.equal(copy.selectable, availability === "ready");
    assert.equal(copy.next === null, availability === "ready");
  }
});

test("concurrent reports merge into one honest status: running beats failed beats complete, flags are any-of", () => {
  const base = {
    schemaVersion: 1, generatedAt: now, sourceCapturedAt: now - 1000, sourceReceivedAt: null,
    inputRevision: { sequence: 5, journalThrough: 50, runtimeSequence: 3 }, analysisVersion: 1, stale: false, pending: false, error: null, result: null,
  };
  const complete = { ...base, jobId: "a", state: "complete", generatedAt: now + 5, stale: true, result: { parts: 1, bytes: 10, hash: "f".repeat(64) } };
  const failed = { ...base, jobId: "b", state: "failed", error: "runtime_missing" };
  const running = { ...base, jobId: "c", state: "running", pending: true };
  assert.equal(mergeReports([]), null);
  assert.deepEqual(mergeReports([complete]), complete);
  const merged = mergeReports([complete, failed, running]);
  assert.deepEqual([merged.state, merged.jobId, merged.error, merged.stale, merged.pending], ["running", "c", "runtime_missing", true, true]);
  const settled = mergeReports([complete, failed]);
  assert.deepEqual([settled.state, settled.error, settled.stale], ["failed", "runtime_missing", true]);
});

test("snapshot lines report pending, stale and failed states separately from empty data", () => {
  const terms = lines => lines.map(line => line.term);
  const tones = lines => lines.map(line => line.tone).filter(tone => tone !== undefined);
  assert.deepEqual(tones(snapshotLines(profile, null)), []);
  assert.equal(snapshotLines(profile, null).find(line => line.term === "Report")?.detail, "Not requested yet");
  const report = {
    schemaVersion: 1, jobId: "00000000-0000-4000-8000-000000000000", state: "failed", generatedAt: now,
    sourceCapturedAt: now - 1000, sourceReceivedAt: null, inputRevision: { sequence: 5, journalThrough: 50, runtimeSequence: 3 },
    analysisVersion: 1, stale: true, pending: true, error: "runtime_missing", result: null,
  };
  assert.deepEqual(tones(snapshotLines(profile, report)), ["pending", "stale", "failed"]);
  assert.deepEqual(terms(snapshotLines(profile, report)).slice(0, 4), ["Source captured", "Received by skillar", "Revision", "Report"]);
  const failed = snapshotLines(profile, null, { status: 503, code: "dashboard_unavailable" });
  assert.deepEqual(tones(failed), ["failed", "failed"]);
  assert.equal(failed.find(line => line.term === "Report")?.tone, "failed");
  assert.equal(failed.at(-1)?.term, "Request failed");
});
