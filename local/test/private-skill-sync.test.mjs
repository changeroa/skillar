import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir } from "./_helpers.mjs";
import { atomicCloudJson } from "../dist/sync/cloud-connection.js";
import { CloudHttp } from "../dist/sync/cloud-http.js";
import { capturePrivateSkill } from "../dist/skills/capture.js";
import { previewPrivatePublication } from "../dist/skills/cloud-plan.js";
import { pullPrivateSkill, pushPrivateSkill } from "../dist/skills/transfer.js";
import { PRIVATE_SKILL_MAX_REQUEST_BYTES, verifyPrivateSkillPackage } from "../dist/skills/package.js";
import { collectSkillRelativeFiles } from "../dist/catalog/scanner.js";
import { previewSkill } from "../dist/skills/plan.js";
import { applySkill } from "../dist/skills/apply.js";
import { rollbackSkill } from "../dist/skills/rollback.js";

const skillId = "11223344-1122-4122-8122-112233445566";
const now = 1_800_000_000_000;

test("collector-sized sources publish pull apply and roll back without dropping bytes or files", async t => {
  // Given: exactly the collector's 512 resources and 16 MiB, above every former quota.
  const f = fixture(t);
  const markdown = "---\nname: fixture\ndescription: Synthetic fixture\n---\n" + "a".repeat(64 * 1024);
  writeFileSync(join(f.root, "SKILL.md"), markdown);
  for (let i = 0; i < 509; i++) writeFileSync(join(f.root, "notes", `${i}.txt`), "a");
  const large = new Uint8Array(16 * 1024 * 1024 - Buffer.byteLength(markdown) - 3 - 509).fill(97);
  writeFileSync(join(f.root, "large.bin"), large);
  const collected = await collectSkillRelativeFiles(f.root);
  assert.equal(collected.length, 512);
  assert.equal(collected.reduce((sum, file) => sum + file.size, 0), 16 * 1024 * 1024);
  const directory = realpathSync(f.directory);
  const destination = join(directory, "destination"), outputPath = join(directory, "export.json");
  mkdirSync(destination);
  // Exercise the large before-file backup as well as incoming bytes.
  writeFileSync(join(destination, "large.bin"), large);
  // When
  const publication = await f.preview();
  await pushPrivateSkill(f.home, f.planPath, true, f.fetcher);
  await pullPrivateSkill(f.home, { skillId, digest: publication.package.manifestDigest, outputPath }, f.fetcher);
  const planPath = join(directory, "apply.json");
  const plan = await previewSkill({ packagePath: outputPath, destinationRoot: destination, planPath, allowOverwrite: true });
  const applied = await applySkill(planPath);
  // Then
  assert.equal(plan.files.length, 512);
  assert.equal(applied.status, "applied");
  for (const resource of collected) {
    assert.deepEqual(readFileSync(join(destination, resource.relative)), readFileSync(join(f.root, resource.relative)));
  }
  assert.equal((await rollbackSkill(applied.receipt)).status, "rolled_back");
  assert.deepEqual(readFileSync(join(destination, "large.bin")), Buffer.from(large));
  assert.equal(existsSync(join(destination, "SKILL.md")), false);
});

for (const excess of ["count", "bytes"]) test(`capture refuses excess ${excess} before metadata or upload`, async t => {
  // Given
  const f = fixture(t);
  if (excess === "count") {
    for (let i = 0; i < 511; i++) writeFileSync(join(f.root, "notes", `${i}.txt`), "");
  } else writeFileSync(join(f.root, "large.bin"), new Uint8Array(16 * 1024 * 1024));
  // When / Then
  await assert.rejects(f.preview(), { code: "quota" });
  assert.deepEqual(f.state.requests, []);
  assert.equal(existsSync(f.planPath), false);
});

function fixture(t) {
  const directory = makeTempDir("private-skill-sync-");
  t.after(() => removeDir(directory));
  t.mock.method(Date, "now", () => now);
  const root = join(directory, "skill"), home = join(directory, "home"), planPath = join(directory, "plan.json");
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(join(root, "SKILL.md"), "---\nname: fixture\ndescription: Synthetic fixture\n---\nSynthetic instructions");
  writeFileSync(join(root, "notes/pixel.bin"), new Uint8Array([0, 255, 128]));
  const connection = {
    version: 1, instanceId: randomUUID(), origin: "https://skillar.sh",
    accountId: "account-fixture", deviceId: "device-fixture", generation: 1,
    token: "t".repeat(43), expiresAt: now / 1000 + 3600,
  };
  atomicCloudJson(home, "connection.json", connection);
  const state = {
    identity: { accountId: connection.accountId, generation: 1,
      deviceId: connection.deviceId, scopes: ["skills:read", "skills:write"] },
    head: null, packets: new Map(), requests: [], corrupt: false,
  };
  const detail = () => ({
    skill: { skillId, name: "fixture", description: "Synthetic fixture", head: state.head, updatedAt: now },
    versions: [...state.packets.keys()].map(digest => ({ digest, createdAt: now, pinned: false })),
  });
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname, body = options.body === undefined ? undefined : JSON.parse(options.body);
    state.requests.push({ path, method: options.method, body });
    if (path === "/v1/skills/identity") return Response.json(state.identity);
    if (path === `/v1/skills/${skillId}`) return state.head === null ?
      Response.json({ error: "not_found" }, { status: 404 }) : Response.json(detail());
    if (path === `/v1/skills/${skillId}/versions` && options.method === "POST") {
      if (JSON.stringify(body.base) !== JSON.stringify(state.head)) {
        return Response.json({ error: "head_conflict" }, { status: 409 });
      }
      assert.equal(body.acknowledgePrivateUpload, true);
      await verifyPrivateSkillPackage(body.package);
      state.packets.set(body.package.manifestDigest, body.package);
      state.head = { digest: body.package.manifestDigest, revision: (state.head?.revision ?? 0) + 1 };
      return Response.json(detail());
    }
    const digest = path.split("/").at(-1), packet = state.packets.get(digest);
    if (packet === undefined) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ skillId, version: { digest, createdAt: now, pinned: false },
      package: state.corrupt ? { ...packet,
        contents: packet.contents.map((content, index) => index === 0 ? { ...content, body: btoa("tampered") } : content),
      } : packet });
  };
  const preview = () => previewPrivatePublication(home, { sourceRoot: root, skillId, planPath }, fetcher);
  return { directory, root, home, planPath, connection, state, fetcher, preview };
}

test("publication preview sends only metadata requests and stores no bearer credential", async t => {
  // Given
  const f = fixture(t);
  // When
  const plan = await f.preview();
  // Then
  assert.equal(plan.base, null);
  assert.ok(f.state.requests.every(request => request.method === "GET" && request.body === undefined));
  assert.equal(readFileSync(f.planPath, "utf8").includes(f.connection.token), false);
  assert.deepEqual(plan.package.manifest.resources.map(resource => resource.path), ["SKILL.md", "notes/pixel.bin"]);
});

test("no acknowledgement means no plan read and no network request", async t => {
  // Given
  const f = fixture(t);
  // When / Then
  await assert.rejects(pushPrivateSkill(f.home, f.planPath, false, f.fetcher),
    { code: "private_upload_ack_required" });
  assert.deepEqual(f.state.requests, []);
});

test("a publication plan cannot become a new resource inside its own source", async t => {
  // Given
  const f = fixture(t), planPath = join(f.root, "plan.json");
  // When / Then
  await assert.rejects(previewPrivatePublication(f.home, { sourceRoot: f.root, skillId, planPath }, f.fetcher),
    { code: "artifact_inside_source" });
  assert.equal(existsSync(planPath), false);
  assert.deepEqual(f.state.requests, []);
});

test("a directory alias cannot hide a publication plan inside the source", async t => {
  // Given
  const f = fixture(t), alias = join(f.directory, "source-alias");
  symlinkSync(f.root, alias, "dir");
  const planPath = join(alias, "plan.json");
  // When / Then
  await assert.rejects(previewPrivatePublication(f.home, { sourceRoot: f.root, skillId, planPath }, f.fetcher),
    { code: "artifact_inside_source" });
  assert.equal(existsSync(planPath), false);
  assert.deepEqual(f.state.requests, []);
});

test("explicit publication uploads exactly the reviewed immutable package", async t => {
  // Given
  const f = fixture(t), plan = await f.preview();
  // When
  const result = await pushPrivateSkill(f.home, f.planPath, true, f.fetcher);
  // Then
  assert.deepEqual(result, { status: "published", skillId,
    head: { digest: plan.package.manifestDigest, revision: 1 } });
  assert.deepEqual(f.state.packets.get(result.head.digest), plan.package);
});

test("a changed source is rejected before any publication request", async t => {
  // Given
  const f = fixture(t);
  await f.preview();
  writeFileSync(join(f.root, "SKILL.md"), "changed");
  f.state.requests.length = 0;
  // When / Then
  await assert.rejects(pushPrivateSkill(f.home, f.planPath, true, f.fetcher), { code: "source_changed" });
  assert.deepEqual(f.state.requests, []);
});

test("a tampered saved package fails before any publication request", async t => {
  // Given
  const f = fixture(t);
  await f.preview();
  const plan = JSON.parse(readFileSync(f.planPath, "utf8"));
  plan.package.contents[0].body = btoa("tampered");
  writeFileSync(f.planPath, JSON.stringify(plan));
  f.state.requests.length = 0;
  // When / Then
  await assert.rejects(pushPrivateSkill(f.home, f.planPath, true, f.fetcher));
  assert.deepEqual(f.state.requests, []);
});

test("normalizing artifact directories does not permit a symlinked plan file", async t => {
  // Given
  const f = fixture(t);
  await f.preview();
  const retained = join(f.directory, "retained-plan.json");
  renameSync(f.planPath, retained);
  symlinkSync(retained, f.planPath);
  f.state.requests.length = 0;
  // When / Then
  await assert.rejects(pushPrivateSkill(f.home, f.planPath, true, f.fetcher), { code: "not_regular" });
  assert.deepEqual(f.state.requests, []);
});

test("offline identity verification never becomes a successful publication acknowledgement", async t => {
  // Given
  const f = fixture(t);
  await f.preview();
  // When / Then
  await assert.rejects(pushPrivateSkill(f.home, f.planPath, true, async () => {
    throw new TypeError("synthetic-network-failure");
  }), { state: "retry", code: "network_unavailable" });
  assert.equal(f.state.head, null);
  assert.equal(f.state.packets.size, 0);
});

test("a replaced connection cannot publish a plan reviewed for another account", async t => {
  // Given
  const f = fixture(t);
  await f.preview();
  atomicCloudJson(f.home, "connection.json", { ...f.connection, accountId: "other-account" });
  f.state.identity.accountId = "other-account";
  // When / Then
  await assert.rejects(pushPrivateSkill(f.home, f.planPath, true, f.fetcher), { code: "connection_changed" });
  assert.ok(f.state.requests.every(request => request.method === "GET"));
});

test("a concurrent remote head change remains a conflict instead of an overwrite", async t => {
  // Given
  const f = fixture(t);
  await f.preview();
  f.state.head = { digest: "b".repeat(64), revision: 2 };
  // When / Then
  await assert.rejects(pushPrivateSkill(f.home, f.planPath, true, f.fetcher),
    { status: 409, message: "head_conflict" });
  assert.deepEqual(f.state.head, { digest: "b".repeat(64), revision: 2 });
  assert.equal(f.state.packets.size, 0);
});

test("a private read-only credential cannot preview an upload", async t => {
  // Given
  const f = fixture(t);
  f.state.identity.scopes = ["skills:read"];
  // When / Then
  await assert.rejects(f.preview(), { code: "private_skill_permission_required" });
  assert.equal(existsSync(f.planPath), false);
});

test("a pinned pull verifies binary bytes before writing a private export", async t => {
  // Given
  const f = fixture(t), captured = await capturePrivateSkill(f.root);
  f.state.packets.set(captured.package.manifestDigest, captured.package);
  const outputPath = join(f.directory, "export.json");
  // When
  const result = await pullPrivateSkill(f.home, { skillId,
    digest: captured.package.manifestDigest, outputPath }, f.fetcher);
  // Then
  assert.equal(result.status, "downloaded");
  const verified = await verifyPrivateSkillPackage(JSON.parse(readFileSync(outputPath, "utf8")).package);
  assert.deepEqual(verified.files.get("notes/pixel.bin"), new Uint8Array([0, 255, 128]));
});

test("tampered remote bytes do not create a local export", async t => {
  // Given
  const f = fixture(t), captured = await capturePrivateSkill(f.root);
  f.state.packets.set(captured.package.manifestDigest, captured.package);
  f.state.corrupt = true;
  const outputPath = join(f.directory, "export.json");
  // When / Then
  await assert.rejects(pullPrivateSkill(f.home, { skillId,
    digest: captured.package.manifestDigest, outputPath }, f.fetcher));
  assert.equal(existsSync(outputPath), false);
});

test("picked resource symlinks fail before metadata or content transfer", async t => {
  // Given
  const f = fixture(t), outside = join(f.directory, "outside");
  writeFileSync(outside, "SYNTHETIC_OUTSIDE_SENTINEL");
  symlinkSync(outside, join(f.root, "escape.txt"));
  // When / Then
  await assert.rejects(f.preview(), { code: "not_regular" });
  assert.deepEqual(f.state.requests, []);
});

test("a private upload can explicitly opt into the larger bounded transport limit", async () => {
  // Given
  const requests = [];
  const http = new CloudHttp("https://skillar.sh", "t".repeat(43), async (_url, options) => {
    requests.push(options.body);
    return Response.json({});
  });
  const body = JSON.stringify({ data: "x".repeat(3 * 1024 * 1024) });
  // When
  await http.request("/v1/skills/resource/versions", { body, maxRequestBytes: PRIVATE_SKILL_MAX_REQUEST_BYTES });
  // Then
  assert.deepEqual(requests, [body]);
});

test("larger private limits do not raise default or activity request limits", async () => {
  // Given
  const requests = [];
  const http = new CloudHttp("https://skillar.sh", "t".repeat(43), async url => {
    requests.push(url);
    return Response.json({});
  });
  // When / Then
  await assert.rejects(http.request("/v1/skills/resource/versions", { body: "x".repeat(256 * 1024 + 1) }),
    { code: "request_too_large" });
  await assert.rejects(http.request("/v1/activity/batches", { maxRequestBytes: PRIVATE_SKILL_MAX_REQUEST_BYTES }),
    { name: "ZodError" });
  assert.deepEqual(requests, []);
});
