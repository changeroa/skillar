// Build the skillar Astryx theme into dist/ (theme.css + skillar.js).
// Lives inside the packaged tree so `npm run build` (prebuild) works both in
// the monorepo and in the packed-CLI staging layout, where repo-root
// scripts/ does not exist.
//
// Modes:
//   default     Build when the Astryx CLI is resolvable. When it is not
//               (packed/staged installs ship prebuilt dist), fall back to
//               the existing dist/theme.css with a note.
//   --required  Always build; fail when the CLI cannot be resolved.
//               Used by the repo-level CI entry (scripts/build-theme.mjs).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const themeDir = fileURLToPath(new URL(".", import.meta.url));
const localRoot = fileURLToPath(new URL("../../../", import.meta.url));
const required = process.argv.includes("--required");

const cliCandidates = [
  "node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs",
  "../site/node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs",
];
const cli = cliCandidates.map(p => localRoot + p).find(existsSync);

if (!cli) {
  if (!required && existsSync(themeDir + "dist/theme.css")) {
    console.log("skillar-theme: @astryxdesign/cli not resolvable here; using existing dist/theme.css (packed layout)");
    process.exit(0);
  }
  console.error("skillar-theme: @astryxdesign/cli not found — run bun install in site first");
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  cli, "theme", "build",
  "dashboard/design/skillar-theme/neutralTheme.ts",
  "--out", "dashboard/design/skillar-theme/dist/theme.css",
  "--icons-specifier", "@astryxdesign/theme-neutral",
], { cwd: localRoot, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
