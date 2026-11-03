import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { makeTempDir, removeDir, sandboxEnv } from "./_helpers.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test("packed CLI, cloud wire and private search execute without an unpublished shared sibling package", async t => {
  const directory = makeTempDir("skillar-packed-");
  t.after(() => removeDir(directory));
  // Other native test files compile dist independently. Build the real package
  // in an isolated source snapshot so npm pack cannot race those compilers.
  const staging = join(directory, "build"), stagedLocal = join(staging, "local");
  const stagedShared = join(staging, "shared");
  mkdirSync(stagedLocal, { recursive: true });
  mkdirSync(stagedShared);
  for (const name of ["package.json", "tsconfig.json", "build-cloud.mjs", "build-dashboard.mjs",
    "src", "dashboard", "packs", "docs", "README.md"]) {
    cpSync(join(root, name), join(stagedLocal, name), { recursive: true });
  }
  const shared = fileURLToPath(new URL("../../shared/", import.meta.url));
  cpSync(shared, stagedShared, { recursive: true,
    filter: source => !["node_modules", "dist"].some(name =>
      source === join(shared, name) || source.startsWith(`${join(shared, name)}/`)),
  });
  symlinkSync(join(root, "node_modules"), join(stagedLocal, "node_modules"), "dir");
  symlinkSync(join(shared, "node_modules"), join(stagedShared, "node_modules"), "dir");
  await exec("npm", ["run", "build"], { cwd: stagedShared, maxBuffer: 4 * 1024 * 1024 });
  await exec("npm", ["run", "build"], { cwd: stagedLocal, maxBuffer: 4 * 1024 * 1024 });
  const { stdout } = await exec("npm", ["pack", "--json", "--pack-destination", directory], {
    cwd: stagedLocal, maxBuffer: 4 * 1024 * 1024,
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
    const {DatabaseSync}=await import("node:sqlite");
    const {readFileSync}=await import("node:fs");
    const {createSearchIndex}=await import("./dist/search/index.js");
    const fields=await import("./dist/catalog/fields.js");
    const parsed=fields.splitSkillMarkdown("---\\nname: package-fixture\\ndescription: Synthetic package\\naliases_ko: [자료]\\n---\\nBody");
    const metadata=fields.extractFields(parsed.frontmatter,parsed.body);
    if(!metadata)throw new Error("packed catalog parser failed");
    const db=new DatabaseSync(":memory:");
    db.exec(readFileSync("./src/store/schema.sql","utf8"));
    const index=createSearchIndex(db);
    index.rebuild([{...metadata,uri:"skill://local/fixture/SKILL.md",rootId:"fixture",dir:"fixture",
      digest:"fixture-digest",manifestDigest:"fixture-manifest",resources:[],mtimeMs:0}]);
    const found=index.search("자료",{mode:"explicit",limit:5});
    if(found.candidates[0]?.uri!=="skill://local/fixture/SKILL.md")throw new Error("packed search failed");
    db.close();
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
