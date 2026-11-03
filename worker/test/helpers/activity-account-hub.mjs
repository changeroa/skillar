// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { WebSocket } from "ws";

export const paths = Object.fromEntries(["changes", "ws", "stream", "lease", "revoke"]
  .map(name => [name, `/v1/activity/events/${name}`]));
export const browser = (extra = {}) => ({
  kind: "browser", accountId: "account-a", generation: 1, shardId: "activity-00",
  issuer: "https://skillar.sh", sessionId: "a".repeat(40), deviceId: null,
  scopes: ["activity:read", "device:manage"], ...extra,
});
const source = `
import { AccountHub } from "./src/activity/account-hub.ts";
import { accountEventsRequest } from "./src/activity/account-events.ts";
const realNow=Date.now.bind(Date);
let now;
Date.now=()=>now??realNow();
export class TestHub extends AccountHub {
  boot=crypto.randomUUID();
  empty;
  async schedule() {
    await super.schedule();
    if(this.connections.streams.size===0) this.empty?.resolve();
  }
  async fetch(request) {
    const path=new URL(request.url).pathname;
    if(path==="/__test/inspect") return Response.json({
      boot:this.boot,now,alarm:await this.ctx.storage.getAlarm(),
      attachments:this.ctx.getWebSockets().map(ws=>ws.deserializeAttachment()),
      streams:this.connections.streams.size,checkpoint:await this.ctx.storage.get("notification"),
    });
    if(path==="/__test/time") {now=(await request.json()).now;return Response.json({now});}
    if(path==="/__test/alarm") {await super.alarm();return Response.json({ok:true});}
    if(path==="/__test/arm-empty") {this.empty=Promise.withResolvers();return Response.json({ok:true});}
    if(path==="/__test/empty") {await this.empty.promise;return Response.json({empty:true});}
    if(path==="/__test/native-stream") {
      const response=await super.fetch(new Request("https://activity.internal/v1/activity/events/stream",
        {headers:request.headers}));
      this.reader=response.body.getReader();
      await this.reader.read();
      return Response.json({status:response.status});
    }
    if(path==="/__test/cancel-response") {
      await this.reader.cancel();return Response.json({cancelled:true});
    }
    if(path==="/__test/abort") {
      this.aborter.abort();return Response.json({ok:true});
    }
    if(path.endsWith("/stream")) {
      this.aborter=new AbortController();
      return super.fetch(new Request(request,{signal:AbortSignal.any([request.signal,this.aborter.signal])}));
    }
    return super.fetch(request);
  }
}
export default { async fetch(request,env) {
  now??=realNow();
  if(request.headers.has("x-test-forward-url")) request=new Request(request.headers.get("x-test-forward-url"),request);
  const url=new URL(request.url);
  if(url.pathname.startsWith("/__test/")) {
    const id=env.ACCOUNT_HUB.idFromName(request.headers.get("x-test-target")??"account-a");
    const stub=env.ACCOUNT_HUB.get(id);
    if(url.pathname==="/__test/notify") return stub.fetch(new Request("https://hub.internal/notify",request));
    if(url.pathname==="/__test/direct-revoke") return stub.fetch(new Request("https://activity.internal/v1/activity/events/revoke",request));
    return stub.fetch(request);
  }
  return await accountEventsRequest(request,env)??new Response("not an event route",{status:418});
} };
`;
const bundle = build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    sourcefile: "activity-account-hub-fixture.mjs" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  external: ["cloudflare:workers"],
});

export function bounded(promise, label = "event") {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out awaiting ${label}`)), 5000);
  })]).finally(() => clearTimeout(timer));
}

function inbox(socket) {
  const values = [], waiters = [];
  socket.addEventListener("message", event => {
    const value = event.data === "pong" ? "pong" : JSON.parse(event.data);
    if (waiters.length) waiters.shift()(value);
    else values.push(value);
  });
  return { next: () => bounded(values.length ? Promise.resolve(values.shift()) :
    new Promise(resolve => waiters.push(resolve)), "WebSocket message") };
}

export function closed(socket) {
  // Observe the protocol Close frame, not the later TCP FIN (workerd may keep TCP half-open).
  return bounded(new Promise(resolve => socket._receiver.once("conclude", (code, reason) => {
    resolve({ code, reason: reason.toString() });
  })), "WebSocket Close frame");
}

async function migrate(db, path) {
  let current = "", trigger = false;
  const statements = [];
  for (const line of (await readFile(path, "utf8")).replace(/^--.*$/gm, "").split("\n")) {
    if (!line.trim()) continue;
    current += `${line} `;
    if (/^\s*CREATE TRIGGER/i.test(line)) trigger = true;
    if (trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) {
      statements.push(db.prepare(current.trim()));
      current = ""; trigger = false;
    }
  }
  assert.equal(current, "");
  await db.batch(statements);
}

export async function fixture(t, { origins = {} } = {}) {
  const cleanup = [];
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{
    dev: { unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }] }, config: {
    type: "worker", name: "account-hub-fixture", compatibilityDate: "2026-09-03",
    compatibilityFlags: ["enable_request_signal"],
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
    env: {
      ...Object.fromEntries(Object.entries(origins).map(([key, value]) => [key, { type: "text", value }])),
      ACTIVITY: { type: "d1", name: "hub-activity" }, ACCOUNTS: { type: "d1", name: "hub-accounts" },
      ACCOUNT_HUB: { type: "durable-object", worker: "account-hub-fixture", exportName: "TestHub" },
    },
    exports: { TestHub: { type: "durable-object", storage: "sqlite" } },
  } }] });
  t.after(async () => {
    try { for (const close of cleanup) await close(); }
    finally { await runtime.dispose(); }
  });
  const db = await runtime.getD1Database("ACTIVITY");
  const accounts = await runtime.getD1Database("ACCOUNTS");
  const migrations = new URL("../../activity-migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter(file => file.endsWith(".sql")).sort()) {
    await migrate(db, new URL(file, migrations));
  }
  for (const file of ["0001_accounts.sql", "0002_activity_accounts.sql", "0003_activity_consent.sql", "0004_account_events.sql"]) {
    await migrate(accounts, new URL(`../../../site/migrations/${file}`, import.meta.url));
  }
  const seed = async (who = browser(), expires = Math.floor(Date.now() / 1000) + 3600) => {
    await accounts.prepare("INSERT OR IGNORE INTO users VALUES (?,?,'','',0,0)")
      .bind(who.accountId, `${who.accountId}@example.com`).run();
    await accounts.prepare("INSERT OR IGNORE INTO accounts(account_id,user_sub) VALUES (?,?)")
      .bind(who.accountId, who.accountId).run();
    await accounts.prepare("INSERT INTO sessions VALUES (?,?,?)").bind(who.sessionId, who.accountId, expires).run();
    await db.prepare("INSERT OR IGNORE INTO tenant_fences VALUES (?,?,'active')").bind(who.accountId, who.generation).run();
  };
  await seed();
  const send = (path, options = {}) => {
    const { who = browser(), body, headers = {}, origin = "https://activity.internal", signal } = options;
    return runtime.dispatchFetch(origin + path, {
      method: body === undefined ? "GET" : "POST", signal,
      headers: { "x-skillar-principal": JSON.stringify(who), ...(body === undefined ? {} :
        { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const control = async (path, body) => {
    const response = await send(`/__test/${path}`, { body });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const append = async (kind = "activity", who = browser()) => {
    await db.batch([
      db.prepare(`INSERT INTO account_heads VALUES (?, ?, 1, 0)
        ON CONFLICT(account_id,generation) DO UPDATE SET head_seq=head_seq+1`).bind(who.accountId, who.generation),
      db.prepare(`INSERT INTO account_changes(account_id,generation,seq,invalidation_kind)
        SELECT account_id,generation,head_seq,? FROM account_heads WHERE account_id=? AND generation=?`)
        .bind(kind, who.accountId, who.generation),
    ]);
  };
  const notify = (who = browser(), target = who.accountId) => send("/__test/notify", {
    body: { accountId: who.accountId, generation: who.generation }, headers: { "x-test-target": target },
  });
  const websocket = async (options = {}) => {
    const { since, who = browser(), connectionId = crypto.randomUUID() } = options;
    const target = `${paths.ws}?connectionId=${connectionId}${since ? `&since=${since}` : ""}`;
    const url = new URL(await runtime.ready);
    url.protocol = "ws:";
    const socket = new WebSocket(url, { headers: {
      "x-test-forward-url": `https://activity.internal${target}`,
      "x-skillar-principal": JSON.stringify(who),
    } });
    const messages = inbox(socket);
    cleanup.push(() => socket.terminate());
    return { socket, messages, ready: await messages.next(), connectionId };
  };
  const evict = () => runtime.unsafeEvictDurableObject("account-hub-fixture", "TestHub",
    { name: "account-a", webSockets: "hibernate" });
  return { runtime, db, accounts, seed, send, control, append, notify, websocket, evict, cleanup };
}

export async function sse(f, options = {}) {
  const target = `${paths.stream}?connectionId=${crypto.randomUUID()}${options.since ? `&since=${options.since}` : ""}`;
  // Miniflare's common ingress uses a 2025 compatibility date without request abort signals.
  // Exercise the configured worker directly, not that unrelated proxy's cancellation behavior.
  const response = await fetch(await f.runtime.unsafeGetDirectURL("account-hub-fixture"), {
    signal: options.signal,
    headers: { "x-test-forward-url": `https://activity.internal${target}`,
      "x-skillar-principal": JSON.stringify(options.who ?? browser()), ...options.headers },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  f.cleanup.push(() => options.signal?.aborted ? undefined : reader.cancel());
  let buffer = "";
  const next = async () => {
    while (!buffer.includes("\n\n")) {
      const part = await bounded(reader.read(), "SSE frame");
      if (part.done) return null;
      buffer += decoder.decode(part.value, { stream: true });
    }
    const end = buffer.indexOf("\n\n"), raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const fields = Object.fromEntries(raw.split("\n").map(line => {
      const colon = line.indexOf(":"); return [line.slice(0, colon), line.slice(colon + 1).trimStart()];
    }));
    return { event: fields.event, id: fields.id, data: JSON.parse(fields.data) };
  };
  return { reader, next, ready: await next() };
}
