import { build } from "esbuild";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { pruneAstryxCss } from "./dashboard/design/astryx-vendor/prune.mjs";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const out = new URL("dist/dashboard/", root);
await rm(out, { recursive: true, force: true });
await mkdir(new URL("assets/", out), { recursive: true });
export const dashboardBuild = await build({
  entryPoints: [fileURLToPath(new URL("dashboard/main.tsx", root))],
  outdir: fileURLToPath(new URL("assets/", out)),
  entryNames: "app",
  chunkNames: "chunk-[hash]",
  splitting: true,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "react",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "warning",
});
await copyFile(new URL("dashboard/index.html", root), new URL("index.html", out));
await copyFile(new URL("dashboard/styles.css", root), new URL("assets/styles.css", out));
await copyFile(new URL("dashboard/foundation/tokens.css", root), new URL("assets/tokens.css", out));
await copyFile(new URL("dashboard/design/astryx-vendor/reset.css", root), new URL("assets/astryx-reset.css", out));
// Ship only the Astryx atomic classes the built JS references; the pruner
// refuses to write (build fails) if a referenced class would be lost.
const jsAssets = (await readdir(new URL("assets/", out))).filter(name => name.endsWith(".js"));
const pruneStats = await pruneAstryxCss(
  fileURLToPath(new URL("dashboard/design/astryx-vendor/astryx.css", root)),
  jsAssets.map(name => fileURLToPath(new URL(`assets/${name}`, out))),
  fileURLToPath(new URL("assets/astryx.css", out)),
  ["index.html", "__gallery.html"].map(name => fileURLToPath(new URL(`dashboard/${name}`, root))));
console.log(`Pruned astryx.css: ${pruneStats.rawBefore} -> ${pruneStats.rawAfter} bytes (${pruneStats.kept} kept, ${pruneStats.dropped} dropped, ${pruneStats.rescued ?? 0} var rescues)`);
await copyFile(new URL("dashboard/design/skillar-theme/dist/theme.css", root), new URL("assets/skillar-theme.css", out));
await mkdir(new URL("viewers/", out), { recursive: true });
await copyFile(new URL("dashboard/foundation/controls/p1.css", root), new URL("assets/p1.css", out));
await copyFile(new URL("dashboard/foundation/viewers/viewers.css", root), new URL("viewers/viewers.css", out));
for (const [source, name] of [
  ["shell/shell.css", "shell.css"],
  ["controls/controls.css", "controls.css"],
  ["overlays/overlays.css", "overlays.css"],
  ["widgets/widgets.css", "widgets.css"],
  ["widgets/charts.css", "charts.css"],
]) await copyFile(new URL(`dashboard/foundation/${source}`, root), new URL(`assets/${name}`, out));
await copyFile(new URL("NOTICE", root), new URL("NOTICE", out));
// tsc does not copy non-TS assets; the store reads schema.sql and migrations/*.sql next to db.js.
await mkdir(new URL("dist/store/migrations/", root), { recursive: true });
await copyFile(new URL("src/store/schema.sql", root), new URL("dist/store/schema.sql", root));
for (const name of await readdir(new URL("src/store/migrations/", root))) {
  if (name.endsWith(".sql")) await copyFile(new URL(`src/store/migrations/${name}`, root), new URL(`dist/store/migrations/${name}`, root));
}
console.log(`Built dashboard: ${fileURLToPath(out)}`);
