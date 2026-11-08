// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { source } from "./private-skill-runtime.mjs";
import { createPrivateSkillPackage } from "../../../shared/dist/private-skill-package.js";

export const skillId = "1381f285-e3d8-49c2-9c51-228f1d852998";
export const otherId = "2381f285-e3d8-49c2-9c51-228f1d852998";
export const prefix = "/v1/private-skills";
export const now = 1793720000000;
export const browser = (account = "account-a", extra = {}) => ({
  kind: "browser", accountId: account, generation: 1, shardId: "activity-00",
  issuer: "https://skillar.sh", sessionId: account.padEnd(40, "x"),
  deviceId: null, tokenHash: null, scopes: ["skills:read", "skills:write"], ...extra,
});
export const device = (account = "account-a", extra = {}) => ({
  ...browser(account), kind: "device", sessionId: null, deviceId: `device-${account}`,
  tokenHash: account.padEnd(43, "t"), ...extra,
});
export async function packet(marker = "quartz", files = [], markdown) {
  return createPrivateSkillPackage([
    { path: "SKILL.md", mediaType: "text/markdown", bytes: new TextEncoder().encode(
      markdown ?? `---\nname: deploy\ndescription: Deploy quartz services\nexamples: [quartz]\naliases_ko: [배포]\n---\n# Deploy\n\n${marker}\n`,
    ) }, ...files,
  ]);
}
export const publishInput = (value, base = null) => ({
  base, acknowledgePrivateUpload: true, package: value,
});
export const uri = (value, path = "SKILL.md", id = skillId) =>
  `skillar://private/${id}/${value.manifestDigest}/${path}`;
export const key = (value, path = "SKILL.md", account = "account-a", id = skillId) =>
  `private-skills/${account}/1/${id}/${value.manifestDigest}/${value.manifest.resources.find(r => r.path === path).digest}`;
const bundle = build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    sourcefile: "private-skill-backend-fixture.mjs" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  external: ["cloudflare:workers"],
});
async function migrate(db, url) {
  const text = await readFile(url, "utf8");
  let current = "", trigger = false;
  const statements = [];
  for (const line of text.replace(/^--.*$/gm, "").split("\n")) {
    if (!line.trim()) continue;
    current += `${line} `;
    if (/^\s*CREATE TRIGGER/i.test(line)) trigger = true;
    if (trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) {
      statements.push(db.prepare(current.trim()));current = "";trigger = false;
    }
  }
  assert.equal(current, "");
  await db.batch(statements);
}
export async function fixture(t) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "private-skill-backend", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
    env: {
      ACCOUNTS: { type: "d1", name: "private-accounts" },
      ACTIVITY: { type: "d1", name: "private-activity" },
      ACTIVITY_RAW: { type: "r2", name: "private-bytes" },
      PRIVATE_SKILLS_ENABLED: { type: "text", value: "true" },
      PRIVATE_SKILL_CATALOG: { type: "durable-object", worker: "private-skill-backend", exportName: "PrivateSkillCatalog" },
      RATE: { type: "durable-object", worker: "private-skill-backend", exportName: "RateProbe" },
    },
    exports: {
      PrivateSkillCatalog: { type: "durable-object", storage: "sqlite" },
      RateProbe: { type: "durable-object", storage: "sqlite" },
    },
  } }] });
  t.after(() => runtime.dispose());
  const accounts = await runtime.getD1Database("ACCOUNTS"), activity = await runtime.getD1Database("ACTIVITY");
  const bucket = await runtime.getR2Bucket("ACTIVITY_RAW");
  for (const name of ["0001_accounts.sql", "0002_activity_accounts.sql", "0003_activity_consent.sql",
    "0004_account_events.sql", "0005_private_skills.sql"]) {
    await migrate(accounts, new URL(`../../../site/migrations/${name}`, import.meta.url));
  }
  for (const name of ["0001_activity_ledger.sql", "0002_content.sql", "0003_migrations.sql",
    "0004_reports.sql", "0005_runtime.sql", "0006_dashboard_eval.sql", "0007_account_events.sql",
    "0008_private_skill_notifications.sql"]) {
    await migrate(activity, new URL(`../../activity-migrations/${name}`, import.meta.url));
  }
  const seed = async (account = "account-a") => {
    const who = browser(account), token = device(account);
    await accounts.batch([
      accounts.prepare("INSERT INTO users VALUES (?,?,'','',0,0)").bind(account, `${account}@example.com`),
      accounts.prepare("INSERT INTO accounts(account_id,user_sub) VALUES (?,?)").bind(account, account),
      accounts.prepare("INSERT INTO sessions VALUES (?,?,?)").bind(who.sessionId, account, now / 1000 + 10000),
      accounts.prepare("INSERT INTO devices VALUES (?,?,0,NULL)").bind(account, token.deviceId),
      accounts.prepare("INSERT INTO api_tokens VALUES (?,?,?,?,?,?,1,?,NULL)")
        .bind(token.tokenHash, account, token.deviceId, JSON.stringify(token.scopes),
          token.issuer, "skillar:activity", now / 1000 + 10000),
    ]);
  };
  await seed();
  const send = async (path = "", method = "GET", value, who = browser(), headers = {}) => {
    const response = await runtime.dispatchFetch(`https://fixture.invalid${path.startsWith("/test/") ? path : prefix + path}`, {
      method, headers: { "content-type": "application/json", "x-skillar-principal": JSON.stringify(who), ...headers },
      ...(value === undefined ? {} : { body: typeof value === "string" ? value : JSON.stringify(value) }),
    });
    const text = await response.text();
    assert.ok(!text || response.headers.get("content-type")?.includes("application/json"), text);
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  return {
    accounts, activity, bucket, seed, send, rows,
    hook: action => send("/test/hook", "POST", action),
    relay: () => send("/test/relay", "POST", {}),
    config: value => send("/test/config", "POST", value),
    publish: (value, base = null, who = browser(), id = skillId) =>
      send(`/${id}/versions`, "POST", publishInput(value, base), who),
    evict: () => runtime.unsafeEvictDurableObject("private-skill-backend", "PrivateSkillCatalog", { name: "account-a" }),
    limits: value => send("/test/limits", "POST", value),
  };
}
