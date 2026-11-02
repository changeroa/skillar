import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { makeTempDir, removeDir, sandboxEnv } from "./_helpers.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test("packed CLI and cloud wire execute without an unpublished shared sibling package", async t => {
  const directory = makeTempDir("skillar-packed-");
  t.after(() => removeDir(directory));
  const { stdout } = await exec("npm", ["pack", "--json", "--pack-destination", directory], {
    cwd: root, maxBuffer: 4 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  // npm 12 keys pack results by package name; npm 11 returns an array.
  const packed = Array.isArray(result) ? result[0] : result.skillar;
  assert.equal(typeof packed?.filename, "string");
  await exec("tar", ["-xzf", join(directory, packed.filename), "-C", directory]);
  const installed = join(directory, "package");
  // Reuse the already installed declared dependencies, not the monorepo sources.
  symlinkSync(join(root, "node_modules"), join(installed, "node_modules"), "dir");
  const home = join(directory, "home");
  mkdirSync(home);
  const env = sandboxEnv(home);
  const status = await exec(process.execPath, [join(installed, "dist/cli/main.js"), "sync", "status"], {
    cwd: installed, env,
  });
  assert.deepEqual(JSON.parse(status.stdout), { connected: false, deviceId: null, progress: null });
  const wire = await exec(process.execPath, ["--input-type=module", "-e", `
    const wire=await import("./dist/sync/cloud-wire.js");
    const job=await import("./dist/sync/cloud-jobs.js");
    const consent=wire.consentSchema.parse({mode:"local-only"});
    const value=await wire.transformContentRows(consent,{},new Proxy([],{
      get(){throw new Error("must not inspect local-only rows");}
    }));
    if(value!==null||typeof job.stageMigrationJob!=="function")process.exitCode=1;
    else process.stdout.write("packed cloud ready");
  `], { cwd: installed, env });
  assert.equal(wire.stdout, "packed cloud ready");
});
