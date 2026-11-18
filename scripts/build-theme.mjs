// Build the skillar Astryx theme into local/dashboard/design/skillar-theme/dist/.
// The dist output is gitignored on purpose (D-7: artifacts are built in CI,
// not committed). Everything that compiles or tests the dashboard — site
// test/build, local typecheck/build/test — needs this output first, so CI
// runs this script after npm ci and before any of those steps.
// The Astryx CLI is a devDependency of site; no new dependency is added.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliCandidates = [
  "site/node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs",
  "local/node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs",
];
const cli = cliCandidates.map(p => root + p).find(existsSync);
if (!cli) {
  console.error("build-theme: @astryxdesign/cli not found — run npm ci in site (or local) first");
  process.exit(1);
}
const result = spawnSync(process.execPath, [
  cli, "theme", "build",
  "dashboard/design/skillar-theme/neutralTheme.ts",
  "--out", "dashboard/design/skillar-theme/dist/theme.css",
  "--icons-specifier", "@astryxdesign/theme-neutral",
], { cwd: root + "local", stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
