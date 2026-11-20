import assert from "node:assert/strict";
import { join } from "node:path";
import { rmSync } from "node:fs";
import test from "node:test";
import { distImport, makeTempDir, removeDir } from "./_helpers.mjs";
import { activityDb } from "../../site/test/helpers/activity-db.mjs";
import { activityRequest } from "../../site/lib/activity-routes.ts";
import { signCookie, SESSION_COOKIE } from "../../site/lib/auth.ts";

const { connectCloudDeviceFlow, consentReviewNotice, pollPendingConnect, createPendingConnect } =
  await distImport("sync/cloud-pending.js");
const { readConnection } = await distImport("sync/cloud-connection.js");

async function fixture(t) {
  const dir = makeTempDir();
  t.after(() => removeDir(dir));
  const { db: accountsDb, accounts } = await activityDb(t);
  const now = Math.floor(Date.now() / 1000), sid = "s".repeat(43);
  accountsDb.prepare("INSERT INTO users VALUES ('sub','fixture@example.com','','',?,?)").run(now, now);
  accountsDb.prepare("INSERT INTO sessions VALUES (?,'sub',?)").run(sid, now + 3600);
  const env = {
    GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
    SESSION_KEY: "fixture-session-key-at-least-32-characters", PUBLIC_ORIGIN: "https://skillar.sh",
    ACCOUNTS: accounts, ACTIVITY_ENABLED: "true",
  };
  const cookie = `${SESSION_COOKIE}=${await signCookie({ sub: "sub", sid }, "session", env, now)}`;
  const fetcher = (url, init) => activityRequest(new Request(url, init), env);
  return { dir, accountsDb, env, cookie, fetcher };
}

test("browser-approval connect: pending, approve, poll, exchange; consent only from the browser choice", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const lines = [];
  const flow = connectCloudDeviceFlow(f.dir, {
    origin: "https://skillar.sh", uploadIntent: true, open: false,
    io: { out: s => lines.push(s), err: () => {} },
    fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
  });
  // Given: the flow prints the code and the approval URL with the upload pre-check
  let codeLine;
  for (let i = 0; i < 500 && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
    await new Promise(r => setTimeout(r, 5));
  }
  assert.ok(codeLine !== undefined, "flow prints the user code");
  const code = codeLine.split(":")[1].trim();
  assert.ok(lines.some(l => l.includes(`/connections/?code=${encodeURIComponent(code)}&upload=1`)));
  assert.ok(lines.some(l => l.includes("체크된 상태로 열립니다")));
  // And: the approval page summary matches the request (no secrets)
  const summaryResponse = await activityRequest(new Request(
    `https://skillar.sh/api/devices/pending/${encodeURIComponent(code)}`, { headers: { cookie: f.cookie } }), f.env);
  assert.equal(summaryResponse.status, 200);
  const summary = await summaryResponse.json();
  assert.deepEqual(summary.scopes, ["activity:read", "activity:ingest"]);
  // When: the browser approves with an explicit metadata consent choice
  const approved = await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
    method: "POST",
    headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
    body: JSON.stringify({ code, consent: { mode: "metadata" } }),
  }), f.env);
  assert.equal(approved.status, 200);
  // Then: the flow exchanges the one-time grant through the existing boundary
  const connected = await flow;
  assert.equal("token" in connected, false);
  const connection = readConnection(f.dir);
  assert.equal(connection.deviceId.length > 0, true);
  const grantRow = f.accountsDb.prepare("SELECT count(*) AS n FROM device_grants").get();
  assert.equal(grantRow.n, 1);
  const consent = f.accountsDb.prepare("SELECT * FROM device_consents WHERE device_id=?").get(connection.deviceId);
  const record = JSON.parse(consent.consent_json);
  assert.equal(record.mode, "metadata");
  assert.equal(record.scope.deviceId, connection.deviceId);
  assert.deepEqual(record.scope.projectIds, [`device:${connection.deviceId}`]);
  // And: the once-per-device consent notice was already recorded by the connect
  assert.equal(consentReviewNotice(f.dir, connection), null);
  // And: a forgotten notice comes back exactly once
  rmSync(join(f.dir, "cloud", "consent-notice.json"));
  assert.equal(consentReviewNotice(f.dir, connection), "https://skillar.sh/connections/");
  assert.equal(consentReviewNotice(f.dir, connection), null);
});

test("poll stops at expiry and after pickup the request is gone", async t => {
  const f = await fixture(t);
  const issue = await createPendingConnect("https://skillar.sh", {
    deviceLabel: "만료 테스트", scopes: ["activity:read", "activity:ingest"] }, f.fetcher);
  let nowMs = Date.now();
  await assert.rejects(
    pollPendingConnect("https://skillar.sh", { ...issue, expiresIn: 1 }, {
      fetcher: f.fetcher, wait: async () => { nowMs += 600; }, now: () => nowMs,
    }),
    /pending_expired/,
  );
});

test("interactive init offers connect with default yes; explicit flags and non-TTY skip", { timeout: 30000 }, async t => {
  const { runInit } = await distImport("cli/init.js");
  const initEnv = dir => ({ HOME: dir, SKILLAR_NO_CLI: "1", PATH: process.env.PATH });
  const approveOnce = async (f, lines) => {
    let codeLine;
    for (let i = 0; i < 2000 && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    const code = codeLine.split(":")[1].trim();
    const approved = await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
      method: "POST",
      headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }), f.env);
    assert.equal(approved.status, 200);
  };
  // TTY + empty answer (default Y) connects without any flag
  {
    const f = await fixture(t);
    const lines = [];
    const io = { out: s => lines.push(s), err: s => lines.push(s), ask: async q => { lines.push(q); return ""; } };
    const run = runInit({ noService: true }, initEnv(f.dir), io,
      { fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)) });
    await approveOnce(f, lines);
    assert.equal(await run, 0);
    assert.equal(readConnection(join(f.dir, ".skillar")) !== null, true);
    assert.ok(lines.some(l => l.includes("[Y/n]")));
    // A second interactive run is already connected and never asks
    let asked = false;
    const again = await runInit({ noService: true }, initEnv(f.dir),
      { out: () => {}, err: () => {}, ask: async () => { asked = true; return "y"; } },
      { fetcher: f.fetcher, wait: async () => {} });
    assert.equal(again, 0);
    assert.equal(asked, false);
  }
  // TTY + "n" skips and prints the later path
  {
    const f = await fixture(t);
    const lines = [];
    const code = await runInit({ noService: true }, initEnv(f.dir),
      { out: s => lines.push(s), err: s => lines.push(s), ask: async () => "n" },
      { fetcher: f.fetcher, wait: async () => {} });
    assert.equal(code, 0);
    assert.equal(readConnection(join(f.dir, ".skillar")), null);
    assert.ok(lines.some(l => l.includes("skillar sync connect")));
  }
  // Non-TTY without --connect never asks and never connects
  {
    const f = await fixture(t);
    const lines = [];
    const code = await runInit({ noService: true }, initEnv(f.dir),
      { out: s => lines.push(s), err: s => lines.push(s) },
      { fetcher: f.fetcher, wait: async () => {} });
    assert.equal(code, 0);
    assert.equal(readConnection(join(f.dir, ".skillar")), null);
    assert.equal(lines.some(l => l.includes("[Y/n]")), false);
  }
  // --no-connect skips even on a TTY
  {
    const f = await fixture(t);
    let asked = false;
    const code = await runInit({ noService: true, connect: false }, initEnv(f.dir),
      { out: () => {}, err: () => {}, ask: async () => { asked = true; return ""; } },
      { fetcher: f.fetcher, wait: async () => {} });
    assert.equal(code, 0);
    assert.equal(asked, false);
    assert.equal(readConnection(join(f.dir, ".skillar")), null);
  }
});

test("offer connect failure keeps install success; explicit --connect failure returns 1", { timeout: 30000 }, async t => {
  const { runInit } = await distImport("cli/init.js");
  const initEnv = dir => ({ HOME: dir, SKILLAR_NO_CLI: "1", PATH: process.env.PATH });
  const failingFetcher = f => (url, init) =>
    new URL(String(url)).pathname.endsWith("/devices/pending") && init?.method === "POST"
      ? Promise.resolve(new Response("boom", { status: 500 }))
      : f.fetcher(url, init);
  // TTY offer accepted, but the server create call fails: install stays a success
  {
    const f = await fixture(t);
    const lines = [];
    const code = await runInit({ noService: true }, initEnv(f.dir),
      { out: s => lines.push(s), err: s => lines.push(s), ask: async () => "" },
      { fetcher: failingFetcher(f), wait: async () => {} });
    assert.equal(code, 0);
    assert.equal(readConnection(join(f.dir, ".skillar")), null);
    assert.ok(lines.some(l => l.includes("cloud connect failed")));
    assert.ok(lines.some(l => l.includes("skillar sync connect")));
  }
  // Explicit --connect with the same failure returns 1
  {
    const f = await fixture(t);
    const lines = [];
    const code = await runInit({ noService: true, connect: true }, initEnv(f.dir),
      { out: s => lines.push(s), err: s => lines.push(s), ask: async () => "" },
      { fetcher: failingFetcher(f), wait: async () => {} });
    assert.equal(code, 1);
    assert.equal(readConnection(join(f.dir, ".skillar")), null);
    assert.ok(lines.some(l => l.includes("cloud connect failed")));
  }
});

test("publish approval: fresh device gets skills scopes; upgrade reuses the same device", { timeout: 30000 }, async t => {
  const { ensurePrivateSkillAccess } = await distImport("skills/cloud.js");
  const approveFromLines = async (f, lines) => {
    let codeLine;
    for (let i = 0; i < 2000 && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    assert.ok(codeLine !== undefined, "flow prints the user code");
    const code = codeLine.split(":")[1].trim();
    const approved = await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
      method: "POST",
      headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }), f.env);
    assert.equal(approved.status, 200);
    return code;
  };
  // Fresh device: pull needs the read scope only
  {
    const f = await fixture(t);
    const home = join(f.dir, ".skillar");
    const lines = [];
    const io = { out: s => lines.push(s), err: () => {} };
    const run = ensurePrivateSkillAccess(home, {
      write: false, open: false, io, fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
    });
    await approveFromLines(f, lines);
    await run;
    const connection = readConnection(home);
    assert.deepEqual(connection.scopes, ["skills:read"]);
    assert.ok(lines.some(l => l.includes("이 링크를 열어 승인하세요")));
  }
  // Connected device (activity scopes): push asks for the union on the same device
  {
    const f = await fixture(t);
    const home = join(f.dir, ".skillar");
    const lines = [];
    const io = { out: s => lines.push(s), err: () => {} };
    const connect = connectCloudDeviceFlow(home, {
      origin: "https://skillar.sh", open: false, io,
      fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
    });
    const firstCode = await approveFromLines(f, lines);
    await connect;
    const before = readConnection(home);
    assert.deepEqual(before.scopes, ["activity:read", "activity:ingest"]);
    const devicesBefore = f.accountsDb.prepare("SELECT count(*) AS n FROM devices").get().n;
    // When: publish needs more than the device holds
    const upgrade = ensurePrivateSkillAccess(home, {
      write: true, open: false, io, fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
    });
    let upgradeLine;
    for (let i = 0; i < 2000 && (upgradeLine = lines.findLast(l => l.includes("연결 코드:") && !l.includes(firstCode))) === undefined; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    assert.ok(upgradeLine !== undefined, "upgrade flow prints its own code");
    await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
      method: "POST",
      headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
      body: JSON.stringify({ code: upgradeLine.split(":")[1].trim() }),
    }), f.env);
    await upgrade;
    // Then: same device, union scopes, one grant per approval
    const after = readConnection(home);
    assert.equal(after.deviceId, before.deviceId);
    assert.deepEqual(after.scopes, ["activity:read", "activity:ingest", "skills:read", "skills:write"]);
    assert.equal(f.accountsDb.prepare("SELECT count(*) AS n FROM devices").get().n, devicesBefore);
    assert.ok(lines.some(l => l.includes("권한을 추가합니다")));
    // And: with the scopes in place the ensure call is a no-op
    const pendingBefore = f.accountsDb.prepare("SELECT count(*) AS n FROM device_pending_codes").get().n;
    await ensurePrivateSkillAccess(home, {
      write: true, open: false, io, fetcher: f.fetcher, wait: async () => {},
    });
    assert.equal(f.accountsDb.prepare("SELECT count(*) AS n FROM device_pending_codes").get().n, pendingBefore);
  }
});

test("publish approval: legacy connection file without scopes probes device-self", { timeout: 30000 }, async t => {
  const { ensurePrivateSkillAccess } = await distImport("skills/cloud.js");
  const { readFileSync, writeFileSync } = await import("node:fs");
  const f = await fixture(t);
  const home = join(f.dir, ".skillar");
  const lines = [];
  const io = { out: s => lines.push(s), err: () => {} };
  const connect = connectCloudDeviceFlow(home, {
    origin: "https://skillar.sh", open: false, io,
    fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
  });
  let codeLine;
  for (let i = 0; i < 2000 && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
    await new Promise(r => setTimeout(r, 5));
  }
  const firstCode = codeLine.split(":")[1].trim();
  await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
    method: "POST",
    headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
    body: JSON.stringify({ code: firstCode }),
  }), f.env);
  await connect;
  // Given: a legacy file where the scopes field is absent
  const path = join(home, "cloud", "connection.json");
  const legacy = JSON.parse(readFileSync(path, "utf8"));
  delete legacy.scopes;
  writeFileSync(path, JSON.stringify(legacy));
  // When: publish asks for more — the probe must recover the activity scopes
  const upgrade = ensurePrivateSkillAccess(home, {
    write: true, open: false, io, fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
  });
  let upgradeLine;
  for (let i = 0; i < 2000 && (upgradeLine = lines.findLast(l => l.includes("연결 코드:") && !l.includes(firstCode))) === undefined; i++) {
    await new Promise(r => setTimeout(r, 5));
  }
  const secondCode = upgradeLine.split(":")[1].trim();
  await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
    method: "POST",
    headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
    body: JSON.stringify({ code: secondCode }),
  }), f.env);
  await upgrade;
  // Then: the union kept the probed activity scopes and landed on the same device
  const after = readConnection(home);
  assert.equal(after.deviceId, legacy.deviceId);
  assert.deepEqual(after.scopes, ["activity:read", "activity:ingest", "skills:read", "skills:write"]);
});

test("upload question: y pre-checks the approval page, empty/n does not, non-TTY never asks", { timeout: 30000 }, async t => {
  const approveOnce = async (f, lines) => {
    let codeLine;
    for (let i = 0; i < 2000 && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    const code = codeLine.split(":")[1].trim();
    const approved = await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
      method: "POST",
      headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }), f.env);
    assert.equal(approved.status, 200);
  };
  const run = async (t, answer) => {
    const f = await fixture(t);
    const lines = [];
    const ask = answer === undefined ? undefined : async q => { lines.push(q); return answer; };
    const flow = connectCloudDeviceFlow(f.dir, {
      origin: "https://skillar.sh", open: false,
      io: { out: s => lines.push(s), err: () => {}, ...(ask === undefined ? {} : { ask }) },
      fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
    });
    await approveOnce(f, lines);
    await flow;
    return lines;
  };
  // y answers carry the pre-check in the approval URL
  const yesLines = await run(t, "y");
  assert.ok(yesLines.some(l => l.includes("세션 기록 업로드도 켤까요? [y/N]")));
  assert.ok(yesLines.some(l => l.includes("upload=1")));
  // empty answer (default N) keeps the URL plain
  const noLines = await run(t, "");
  assert.ok(noLines.some(l => l.includes("[y/N]")));
  assert.equal(noLines.some(l => l.includes("upload=1")), false);
  // no TTY: never asks, never pre-checks
  const quietLines = await run(t, undefined);
  assert.equal(quietLines.some(l => l.includes("[y/N]")), false);
  assert.equal(quietLines.some(l => l.includes("upload=1")), false);
});

test("scope upgrade never asks the upload question and never carries the pre-check", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const lines = [];
  const first = connectCloudDeviceFlow(f.dir, {
    origin: "https://skillar.sh", open: false,
    io: { out: s => lines.push(s), err: () => {} },
    fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
  });
  let codeLine;
  for (let i = 0; i < 2000 && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
    await new Promise(r => setTimeout(r, 5));
  }
  const code = codeLine.split(":")[1].trim();
  await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
    method: "POST",
    headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
    body: JSON.stringify({ code }),
  }), f.env);
  const connected = await first;
  // Upgrade with uploadIntent true AND an interactive channel: no question, no upload=1
  const upgradeLines = [];
  let asked = false;
  const upgrade = connectCloudDeviceFlow(f.dir, {
    origin: "https://skillar.sh", open: false, upgradeDeviceId: connected.deviceId,
    scopes: ["activity:read", "activity:ingest", "skills:read"], uploadIntent: true,
    io: { out: s => upgradeLines.push(s), err: () => {}, ask: async () => { asked = true; return "y"; } },
    fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)),
  });
  let upgradeCodeLine;
  for (let i = 0; i < 2000 && (upgradeCodeLine = upgradeLines.find(l => l.includes("연결 코드:"))) === undefined; i++) {
    await new Promise(r => setTimeout(r, 5));
  }
  const upgradeCode = upgradeCodeLine.split(":")[1].trim();
  const approved = await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
    method: "POST",
    headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" },
    body: JSON.stringify({ code: upgradeCode }),
  }), f.env);
  assert.equal(approved.status, 200);
  await upgrade;
  assert.equal(asked, false);
  assert.equal(upgradeLines.some(l => l.includes("upload=1")), false);
});

test("connected mode connects first and writes the hosted MCP as the final state; --local-only and a declined connect register the local entry", { timeout: 90000 }, async t => {
  const { runInit } = await distImport("cli/init.js");
  const { writeStub } = await import("./helpers/cli.mjs");
  const { mkdirSync, readFileSync, existsSync, writeFileSync } = await import("node:fs");
  const scenario = async (opts, answer) => {
    const f = await fixture(t);
    mkdirSync(join(f.dir, ".claude"), { recursive: true });
    // The stub claude binary writes nothing, so seed the entry a real `claude mcp add` would have left.
    writeFileSync(join(f.dir, ".claude.json"), JSON.stringify({ mcpServers: { skillar: { type: "http", url: "http://127.0.0.1:8799/mcp" } } }));
    const bin = join(f.dir, "bin"); mkdirSync(bin);
    const log = join(f.dir, "argv.log");
    writeStub(bin, "claude", log);
    const env = { HOME: f.dir, PATH: bin };
    const lines = [];
    const io = { out: s => lines.push(s), err: s => lines.push(s), ask: async q => { lines.push(q); return answer; } };
    const run = runInit({ noService: true, runtimes: ["claude-code"], ...opts }, env, io,
      { fetcher: f.fetcher, wait: () => new Promise(r => setTimeout(r, 10)) });
    let settled = false; run.then(() => { settled = true; }, () => { settled = true; });
    if (answer !== "n" && !opts.localOnly) {
      // Poll until the pairing code shows up (slow under parallel load) instead of a fixed short budget; fail with the output if init ends without one.
      let codeLine;
      for (let i = 0; i < 6000 && !settled && (codeLine = lines.find(l => l.includes("연결 코드:"))) === undefined; i++) await new Promise(r => setTimeout(r, 5));
      assert.ok(codeLine, "no pairing code printed: " + lines.join(""));
      const code = codeLine.split(":")[1].trim();
      const ok = await activityRequest(new Request("https://skillar.sh/api/devices/pending/approve", {
        method: "POST", headers: { cookie: f.cookie, origin: "https://skillar.sh", "content-type": "application/json" }, body: JSON.stringify({ code }) }), f.env);
      assert.equal(ok.status, 200);
    }
    assert.equal(await run, 0, lines.join(""));
    return { log: existsSync(log) ? readFileSync(log, "utf8") : "", out: lines.join("") };
  };
  const connected = await scenario({}, "");
  // Connect comes first, so the hosted entry is the final state and the local daemon entry is never added then removed.
  assert.doesNotMatch(connected.log, /127\.0\.0\.1:\d+\/mcp --header/, "local entry must not be re-added before the switch");
  assert.match(connected.log, /^claude mcp remove --scope user skillar$/m);
  assert.match(connected.log, /^claude mcp add --transport http --scope user skillar https:\/\/skillar\.sh\/mcp$/m);
  assert.match(connected.out, /session upload consent is separate and unchanged/);
  assert.ok(connected.out.indexOf("cloud: connected device") < connected.out.indexOf("applied "), "connect precedes apply");
  const localOnly = await scenario({ localOnly: true }, "");
  assert.doesNotMatch(localOnly.log, /skillar\.sh\/mcp/);
  assert.match(localOnly.log, /127\.0\.0\.1:\d+\/mcp --header/);
  const declined = await scenario({}, "n");
  assert.doesNotMatch(declined.log, /skillar\.sh\/mcp/);
  assert.match(declined.log, /127\.0\.0\.1:\d+\/mcp --header/);
  assert.match(declined.out, /registering the local daemon MCP entries instead/);
});
