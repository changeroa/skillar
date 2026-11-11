import { context } from "esbuild";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The dev fixture server never starts the daemon or writes product data.
const root = new URL("./", import.meta.url);
const out = await mkdtemp(join(tmpdir(), "skillar-dashboard-dev-"));
await mkdir(join(out, "assets"));
await mkdir(join(out, "viewers"));
for (const [source, target] of [
  ["dashboard/index.html", "index.html"],
  ["dashboard/__gallery.html", "__gallery.html"],
  ["dashboard/styles.css", "assets/styles.css"],
  ["dashboard/foundation/tokens.css", "assets/tokens.css"],
  ["dashboard/foundation/gallery.css", "assets/gallery.css"],
  ["dashboard/foundation/shell/shell.css", "assets/shell.css"],
  ["dashboard/foundation/controls/controls.css", "assets/controls.css"],
  ["dashboard/foundation/controls/p1.css", "assets/p1.css"],
  ["dashboard/foundation/viewers/viewers.css", "viewers/viewers.css"],
  ["dashboard/foundation/overlays/overlays.css", "assets/overlays.css"],
  ["dashboard/foundation/widgets/widgets.css", "assets/widgets.css"],
  ["dashboard/foundation/widgets/charts.css", "assets/charts.css"],
  ["NOTICE", "NOTICE"],
]) await copyFile(new URL(source, root), join(out, target));
const ctx = await context({
  absWorkingDir: fileURLToPath(root),
  entryPoints: { "assets/app": "dashboard/main.tsx", "assets/gallery": "dashboard/gallery.ts" },
  outdir: out, bundle: true, splitting: true, format: "esm", platform: "browser",
  target: "es2022", jsx: "automatic", jsxImportSource: "preact",
  nodePaths: [fileURLToPath(new URL("node_modules", root))],
});
await ctx.watch();
const server = await ctx.serve({ servedir: out, host: "127.0.0.1", port: Number(process.env.PORT ?? 0) });
console.log(`Dashboard dev: http://127.0.0.1:${server.port}/?fixtures=1`);
console.log(`Gallery dev: http://127.0.0.1:${server.port}/__gallery.html`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  await ctx.dispose();
  await rm(out, { recursive: true, force: true });
  process.exit(0);
});
