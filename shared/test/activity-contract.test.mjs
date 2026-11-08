import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityBatchSchema, eventFactsSchema, MAX_BATCH_BYTES, parseActivityBatch,
} from "../dist/activity-schema.js";
import {
  authorizeUpload, consentSchema, defaultConsent, retentionSchema,
} from "../dist/activity-consent.js";
import { assessCapability, featureCapabilities } from "../dist/activity-capabilities.js";

const scope = { deviceId: "device", projectIds: ["project"], rootIds: ["root"] };
const grant = {
  mode: "managed-content", version: 2, scope, grantedAtMs: 1000,
  serverProcessingAcknowledged: true, contentKinds: ["prompt"],
};
const upload = {
  deviceId: "device", projectId: "project", rootId: "root", consentVersion: 2,
  fromMs: 1000, toMs: 1100, contentKinds: ["prompt"], backfill: null,
};
const facts = {
  sessionId: "session", kind: "prompt", timestampMs: 1000, sourceOrder: null,
  recordingOrders: { lineage: 0 }, sourceKey: null, status: "unknown",
  inputTokens: null, outputTokens: 0,
};
const batch = {
  schemaVersion: 1, batchId: "batch", deviceId: "device", sourceDomain: "lineage",
  generation: 1, consentVersion: 2, sequence: 1,
  projectId: "project", rootId: "root", range: { fromMs: 1000, toMs: 1100 }, backfill: null,
  journal: { from: 1, through: 1 },
  mutations: [{ entity: "event", key: "event", revision: 1, facts }],
};

test("local capture settings cannot implicitly grant cloud upload", () => {
  // Given / When / Then
  assert.throws(() => authorizeUpload(defaultConsent, upload), { code: "consent_required" });
  assert.equal(consentSchema.safeParse({ ...grant, captureLevel: "full" }).success, false);
  assert.equal(consentSchema.safeParse({ ...grant, serverProcessingAcknowledged: undefined }).success, false);
});

test("explicit managed content grants only selected kinds and device/project/root", () => {
  // Given
  const consent = consentSchema.parse(grant);
  // When / Then
  assert.doesNotThrow(() => authorizeUpload(consent, upload));
  for (const denied of [
    { contentKinds: ["args"] }, { contentKinds: ["private-skills"] },
    { deviceId: "another" }, { projectId: "another" }, { rootId: "another" }, { consentVersion: 1 },
  ]) assert.throws(() => authorizeUpload(consent, { ...upload, ...denied }));
});

test("live grants cannot backfill without a separately scoped snapshot grant", () => {
  // Given
  const consent = consentSchema.parse(grant);
  // When / Then
  assert.throws(() => authorizeUpload(consent, { ...upload, fromMs: 1 }), { code: "range_not_allowed" });
  assert.throws(() => authorizeUpload(consent, {
    ...upload, fromMs: 1, backfill: { version: 3, snapshotId: "snapshot", journalCut: 10 },
  }), { code: "range_not_allowed" });
});

for (const mode of ["metadata", "managed-content"]) {
  test(`${mode} historical grant pins range, version, snapshot and journal cut`, () => {
    // Given
    const backfill = { version: 3, snapshotId: "snapshot", journalCut: 10, range: { fromMs: 1, toMs: 1000 } };
    const consent = consentSchema.parse(mode === "metadata" ?
      { mode, version: 2, scope, grantedAtMs: 1000, backfill } : { ...grant, backfill });
    const historical = { ...upload, fromMs: 1, toMs: 1000, contentKinds: [], backfill: {
      version: 3, snapshotId: "snapshot", journalCut: 10,
    } };
    // When / Then
    assert.doesNotThrow(() => authorizeUpload(consent, historical));
    for (const change of [
      { version: 2 }, { snapshotId: "other" }, { journalCut: 11 },
    ]) assert.throws(() => authorizeUpload(consent, { ...historical, backfill: { ...historical.backfill, ...change } }));
    assert.throws(() => authorizeUpload(consent, { ...historical, fromMs: 0 }));
    assert.throws(() => authorizeUpload(consent, { ...historical, toMs: 1001 }));
  });
}

test("retention defaults to thirty days while longer primary retention never lengthens backups", () => {
  // Given / When
  const consent = consentSchema.parse(grant);
  const longer = retentionSchema.parse({ contentDays: 365, projectionDays: 365 });
  // Then
  assert.deepEqual(consent.retention, { contentDays: 30, projectionDays: 30, backupDays: 30 });
  assert.deepEqual(longer, { contentDays: 365, projectionDays: 365, backupDays: 30 });
  assert.equal(retentionSchema.safeParse({ backupDays: 31 }).success, false);
});

test("metadata rejects raw fields and nested sentinel content instead of stripping it silently", () => {
  // Given
  const metadata = consentSchema.parse({ mode: "metadata", version: 2, scope, grantedAtMs: 1000 });
  // When / Then
  assert.throws(() => authorizeUpload(metadata, upload), { code: "content_not_allowed" });
  for (const extra of [
    { text: "SECRET_SENTINEL" }, { data: { query: "SECRET_SENTINEL" } },
    { args: { nested: { token: "SECRET_SENTINEL" } } },
    { attributes: { cwd: "SECRET_SENTINEL" } }, { firstPrompt: "SECRET_SENTINEL" },
  ]) assert.equal(eventFactsSchema.safeParse({ ...facts, ...extra }).success, false);
  assert.equal(eventFactsSchema.safeParse({ ...facts, recordingOrders: { lineage: { text: "SECRET_SENTINEL" } } }).success, false);
  assert.equal(consentSchema.safeParse({ ...grant, externalModelTransfer: true }).success, false);
  assert.equal(consentSchema.safeParse({ ...grant, mode: "e2ee" }).success, false);
});

test("typed batch preserves unknown zero and source order without trusting payload tenant identity", () => {
  // Given / When
  const parsed = parseActivityBatch(batch);
  // Then
  assert.equal(parsed.mutations[0].facts.inputTokens, null);
  assert.equal(parsed.mutations[0].facts.outputTokens, 0);
  assert.equal(parsed.mutations[0].facts.sourceOrder, null);
  assert.equal(parsed.mutations[0].facts.recordingOrders.lineage, 0);
  assert.equal(activityBatchSchema.safeParse({ ...batch, accountId: "victim" }).success, false);
  assert.equal(activityBatchSchema.safeParse({ ...batch, journal: { from: 2, through: 1 } }).success, false);
});

test("batch boundaries reject excess records and bytes before storage", () => {
  // Given
  const largeOrders = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`${i}-${"x".repeat(500)}`, 1]));
  const oversized = { ...batch, mutations: [{ ...batch.mutations[0], facts: { ...facts, recordingOrders: largeOrders } }] };
  assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > MAX_BATCH_BYTES);
  // When / Then
  assert.throws(() => parseActivityBatch(oversized), { code: "batch_too_large" });
  assert.equal(activityBatchSchema.safeParse({ ...batch, mutations: Array(101).fill(batch.mutations[0]) }).success, false);
});

test("declaring a live range cannot smuggle facts from an unconsented historical period", () => {
  // Given
  const historical = { ...batch, mutations: [{
    ...batch.mutations[0], facts: { ...facts, timestampMs: 999 },
  }] };
  // When / Then
  assert.throws(() => parseActivityBatch(historical), { code: "range_not_allowed" });
});

test("capability inventory covers every source row without conflating protocol surfaces", () => {
  // Given
  const sections = { cli: 15, dashboard: 7, http: 25, "local-mcp": 9, registry: 12, ingestion: 15 };
  const ids = new Set(featureCapabilities.map(feature => feature.id));
  // When / Then
  assert.equal(ids.size, 83);
  for (const [prefix, count] of Object.entries(sections)) {
    for (let i = 1; i <= count; i++) assert.ok(ids.has(`${prefix}-${String(i).padStart(2, "0")}`));
  }
  assert.notEqual(featureCapabilities.find(row => row.id === "registry-01").source,
    featureCapabilities.find(row => row.id === "local-mcp-04").source);
});

test("capabilities never advertise unimplemented remote features as available", () => {
  // Given
  const feature = featureCapabilities.find(row => row.id === "dashboard-02");
  const consent = consentSchema.parse(grant);
  // When / Then
  assert.deepEqual(assessCapability(feature, { consent, completedStages: [], connectorOnline: true }),
    { status: "planned", stage: "P12" });
  assert.deepEqual(assessCapability(feature, { consent, completedStages: ["P12"], connectorOnline: true }),
    { status: "degraded", reason: "content-consent" });
  assert.deepEqual(assessCapability(feature, { consent: defaultConsent, completedStages: ["P12"], connectorOnline: true }),
    { status: "local-only" });
});

test("a completed metadata capability is available without granting raw content", () => {
  // Given
  const feature = featureCapabilities.find(row => row.id === "http-13");
  const consent = consentSchema.parse({ mode: "metadata", version: 2, scope, grantedAtMs: 1000 });
  // When / Then
  assert.deepEqual(assessCapability(feature, { consent, completedStages: ["P9"], connectorOnline: false }),
    { status: "available" });
});

test("connector-dependent completed features degrade while their source device is offline", () => {
  // Given
  const feature = featureCapabilities.find(row => row.id === "cli-03");
  const consent = consentSchema.parse({ mode: "metadata", version: 2, scope, grantedAtMs: 1000 });
  // When / Then
  assert.deepEqual(assessCapability(feature, { consent, completedStages: ["P4"], connectorOnline: false }),
    { status: "degraded", reason: "connector-offline" });
});
