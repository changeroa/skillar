import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Reuse every existing real-page check unchanged. Only its two hardcoded
// deployment coordinates change; the gallery origin is configured separately.
const [templatePath, out, base] = process.argv.slice(2);
if (!templatePath || !out || !base) throw new TypeError("Usage: p1-runtime.mjs existing-runtime.mjs out base");
assert.ok(process.env.UXB_GALLERY_BASE, "The development gallery must have its own origin");
const template = await readFile(templatePath, "utf8");
const configured = template.replace(/^const out = ".*";$/m, `const out = ${JSON.stringify(`${out}/runtime`)};`)
  .replace(/^const base = ".*";$/m, `const base = ${JSON.stringify(base)};`)
  .replace(/\bfrom "(\/[^"]+)"/g, (_match, path) => `from "${pathToFileURL(path).href}"`);
assert.ok(configured.includes(`const out = ${JSON.stringify(`${out}/runtime`)};`));
assert.ok(configured.includes(`const base = ${JSON.stringify(base)};`));
await writeFile(`${out}/runtime-provenance.json`, JSON.stringify({
  templatePath, templateSHA256: createHash("sha256").update(template).digest("hex"),
  configuredSHA256: createHash("sha256").update(configured).digest("hex"),
  configurationOnly: ["out", "base", "absolute imports expressed as file URLs"],
  base, galleryBase: process.env.UXB_GALLERY_BASE,
}, null, 2));
const response = await fetch(`${base}/__gallery.html`);
assert.equal(response.status, 404, "Production must not serve the development gallery");
const productionHTML = await response.text();
assert.equal(/id=["']gallery["']/.test(productionHTML), false);
await writeFile(`${out}/production-gallery.json`, JSON.stringify({
  base, gallery: "/__gallery.html", status: response.status, galleryRoot: false, result: "PASS",
}, null, 2));
console.log(`P1_PRODUCTION_GALLERY_ABSENT ${response.status}`);
// The unchanged driver owns process.exit, so run independent checks first.
await import(`data:text/javascript;base64,${Buffer.from(configured).toString("base64")}`);
