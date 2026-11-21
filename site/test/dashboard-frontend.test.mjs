import assert from "node:assert/strict";
import test from "node:test";
import { consentSchema } from "../../shared/dist/activity-consent.js";
import { contentKinds } from "../../shared/dist/activity-schema.js";
import { createGrant, GRANT_SCOPES, routes } from "../src/dashboard/api.ts";
import { readFile } from "node:fs/promises";
import { buildConsent, buildMetadataConsent, draftFromConsent, emptyDraft, projectIdFor } from "../src/dashboard/consent.ts";
import { connectSteps, grantFileName, grantFileText } from "../src/dashboard/grant.ts";
import { AVAILABILITY_COPY, mergeReports, snapshotLines } from "../src/dashboard/status.ts";

const now = 1_800_000_000_000;
const deviceId = "device-under-test";
const fullDraft = { ...emptyDraft(), mode: "managed-content", kinds: [...contentKinds], serverProcessing: true };
const profile = {
  deviceId, sourceDomain: "source-a", sourceSequence: 4, journalThrough: 40, runtimeSequence: 2,
  capturedAtMs: now - 5000, receivedAtMs: now - 4000, availability: "ready",
};

for (const allowPrivateSkills of [false, true]) {
  test(`device grant private scopes are explicitly selected: ${allowPrivateSkills}`, async t => {
    // Given
    let received;
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      received = JSON.parse(options.body);
      return Response.json({ grant: "g".repeat(43), deviceId, expiresAt: now / 1000 + 600 });
    });
    // When
    await (allowPrivateSkills ? createGrant(undefined, true) : createGrant());
    // Then
    assert.deepEqual(received.scopes, allowPrivateSkills ?
      ["activity:read", "activity:ingest", "skills:read", "skills:write"] : GRANT_SCOPES);
  });
}

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
  assert.equal(snapshotLines(profile, null).find(line => line.term === "보고서")?.detail, "아직 요청하지 않음");
  const report = {
    schemaVersion: 1, jobId: "00000000-0000-4000-8000-000000000000", state: "failed", generatedAt: now,
    sourceCapturedAt: now - 1000, sourceReceivedAt: null, inputRevision: { sequence: 5, journalThrough: 50, runtimeSequence: 3 },
    analysisVersion: 1, stale: true, pending: true, error: "runtime_missing", result: null,
  };
  assert.deepEqual(tones(snapshotLines(profile, report)), ["pending", "stale", "failed"]);
  assert.deepEqual(terms(snapshotLines(profile, report)).slice(0, 4), ["출처 수집 시각", "skillar 수신 시각", "리비전", "보고서"]);
  const failed = snapshotLines(profile, null, { status: 503, code: "dashboard_unavailable" });
  assert.deepEqual(tones(failed), ["failed", "failed"]);
  assert.equal(failed.find(line => line.term === "보고서")?.tone, "failed");
  assert.equal(failed.at(-1)?.term, "요청 실패");
});

test("device row one-click on writes a metadata-only consent with defaults and no backfill", () => {
  const consent = buildMetadataConsent(deviceId, 2, now);
  assert.deepEqual(consentSchema.parse(consent), consent);
  assert.equal(consent.mode, "metadata");
  assert.equal(consent.version, 3);
  assert.equal(consent.grantedAtMs, now);
  assert.deepEqual(consent.scope, { deviceId, projectIds: [projectIdFor(deviceId)], rootIds: [] });
  assert.deepEqual(consent.retention, { contentDays: 30, projectionDays: 30, backupDays: 30 });
  assert.equal(consent.backfill, undefined);
});

test("device row has one upload toggle wired to writeConsent, and the standalone withdraw button is gone", async () => {
  const source = await readFile(new URL("../src/dashboard/devices.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("aria-pressed={device.consent.mode !== \"local-only\"}"), true);
  assert.equal(source.includes("buildMetadataConsent(device.deviceId, device.version"), true);
  assert.equal(source.includes("writeConsent(device.deviceId, device.version, consent, signal)"), true);
  assert.equal(source.includes("동의 철회"), false);
  assert.equal(source.includes("<summary>세부 설정</summary>"), true);
});

test("connections page no longer carries a separate upload-consent step", async () => {
  const html = await readFile(new URL("../connections/index.html", import.meta.url), "utf8");
  assert.equal(html.includes("업로드 동의"), false);
  assert.equal((html.match(/connections-steps/g) ?? []).length > 0, true);
});

test("pending approval sends only the code unless the user explicitly chose upload consent", async t => {
  // Given
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, body: options?.body === undefined ? undefined : JSON.parse(options.body) });
    return url.includes("/approve") ? Response.json({ deviceId: "d".repeat(43) }) :
      Response.json({ deviceLabel: "테스트 맥북", scopes: ["activity:ingest"], expiresAtMs: 1800000600000 });
  });
  const { readPending, approvePending } = await import("../src/dashboard/api.ts");
  // When: summary read carries no secrets
  assert.deepEqual(await readPending("ABCD-EFGH"), {
    deviceLabel: "테스트 맥북", scopes: ["activity:ingest"], expiresAtMs: 1800000600000 });
  // And: default off — no consent key leaves the browser without an explicit choice
  await approvePending("ABCD-EFGH", undefined);
  assert.deepEqual(calls[1].body, { code: "ABCD-EFGH" });
  // And: an explicit managed-content choice carries the kinds and the acknowledgement
  await approvePending("ABCD-EFGH", {
    mode: "managed-content", contentKinds: [...contentKinds], serverProcessingAcknowledged: true });
  assert.deepEqual(calls[2].body, { code: "ABCD-EFGH", consent: {
    mode: "managed-content", contentKinds: [...contentKinds], serverProcessingAcknowledged: true } });
});

test("the sessions screen opens its sources without waiting for the device-name request", async () => {
  const { devicesSettledForAutoSelect } = await import("../src/dashboard/status.ts");
  // 출처 전체 화면: 기기 읽기가 로딩 중이든(느림/무응답), 성공이든, 실패든 기다리지 않는다.
  for (const status of ["loading", "ready", "failed"]) assert.equal(devicesSettledForAutoSelect("sessions", status), true);
  // 스킬 화면은 기존 동작 그대로: 기기 읽기가 성공해야 연다.
  assert.equal(devicesSettledForAutoSelect("skills", "loading"), false);
  assert.equal(devicesSettledForAutoSelect("skills", "ready"), true);
  assert.equal(devicesSettledForAutoSelect("skills", "failed"), false);
});
