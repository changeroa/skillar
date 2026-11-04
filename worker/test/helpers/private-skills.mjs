// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { fixture as backendFixture } from "./private-skill-backend.mjs";
export { packet, skillId, otherId, key, uri, now, browser } from "./private-skill-backend.mjs";

const bundle = build({
  entryPoints: [new URL("../../src/private-skills/retention.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
}).then(result => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`));
export async function fixture(t, { migrate = true } = {}) {
  const f = await backendFixture(t);
  const retention = await bundle;
  const install = async () => {
    const sql = await readFile(new URL("../../../site/migrations/0007_private_skill_retention.sql", import.meta.url), "utf8");
    const statements = [];
    let current = "", trigger = false;
    for (const line of sql.replace(/^\s*--.*$/gm, "").split("\n")) {
      if (!line.trim()) continue;
      current += `${line} `;
      if (/^\s*CREATE TRIGGER/i.test(line)) trigger = true;
      if (trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) {
        statements.push(f.accounts.prepare(current.trim()));
        current = ""; trigger = false;
      }
    }
    assert.equal(current, "");
    await f.accounts.batch(statements);
  };
  if (migrate) await install();
  const env = { ACCOUNTS: f.accounts, ACTIVITY_RAW: f.bucket };
  return {
    ...f, env, install,
    sweep: (options, bindings = env) => retention.sweepPrivateSkills(bindings, options),
    status: (identity = { accountId: "account-a", generation: 1 }, bindings = env) =>
      retention.privateSkillPurgeStatus(bindings, identity),
  };
}
