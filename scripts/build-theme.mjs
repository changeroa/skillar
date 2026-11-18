// Repo-level CI entry for the skillar theme build. The implementation lives
// inside the packaged tree (local/dashboard/design/skillar-theme/build.mjs)
// so the packed CLI layout can run it too; this wrapper makes the build
// required (fail instead of falling back to an existing dist) for CI.
// Everything that compiles or tests the dashboard — site test/build, local
// typecheck/build/test — needs the theme dist first, so CI runs this after
// npm ci and before any of those steps.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.execPath, [
  root + "local/dashboard/design/skillar-theme/build.mjs", "--required",
], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
