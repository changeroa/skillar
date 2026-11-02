import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Only this wire facade imports repository-shared runtime modules. Bundle those
// relative imports into dist; keep the local package's declared zod dependency.
await build({
  entryPoints: [fileURLToPath(new URL("src/sync/cloud-wire.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("dist/sync/cloud-wire.js", import.meta.url)),
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
});
