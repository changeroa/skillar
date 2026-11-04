import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// These facades import repository-shared runtime modules. Bundle those
// relative imports into dist; keep the local package's declared zod dependency.
for (const facade of [
  "sync/cloud-wire", "sync/command-wire", "analysis/kernel", "api/report-kernel", "catalog/fields",
  "search/index", "search/fts", "search/lexical", "search/fusion", "search/guidance", "skills/package",
]) {
  await build({
    entryPoints: [fileURLToPath(new URL(`src/${facade}.ts`, import.meta.url))],
    outfile: fileURLToPath(new URL(`dist/${facade}.js`, import.meta.url)),
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node24",
  });
}
