import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const targets = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
const selected = process.argv[2] ? [process.argv[2]] : targets;
for (const target of selected) {
  if (!targets.includes(target)) throw new Error(`Unsupported sidecar target: ${target}`);
  const dir = resolve(import.meta.dir, "dist/sidecars", target);
  mkdirSync(dir, { recursive: true });
  const bunTarget = target === "linux-x64" ? "linux-x64-baseline" : target;
  const code = await Bun.spawn([
    process.execPath, "build", "--compile", `--target=bun-${bunTarget}`,
    "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
    "--asset", "./dist/dashboard", "--asset", "./dist/store", "--asset", "./packs", "--asset", "./package.json",
    "--outfile", resolve(dir, "skillar"), "./dist/cli/main.js", "./dist/sync/cloud-worker.js",
  ], { cwd: import.meta.dir, env: process.env, stdout: "inherit", stderr: "inherit" }).exited;
  if (code !== 0) process.exit(1);
}
