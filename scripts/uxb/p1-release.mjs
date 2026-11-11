import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
const [root, out] = process.argv.slice(2);
if (!root || !out) throw Error("repository and evidence paths required");
const child = spawn("npm", ["pack", "--dry-run", "--json"], { cwd: `${root}/local`, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", stderr = "";
child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
assert.equal(code, 0, stderr);
const packed = JSON.parse(stdout);
await writeFile(`${out}/pack.json`, JSON.stringify(packed, null, 2));
const archive = Object.values(packed).find(entry => entry.name === "skillar");
assert.ok(archive, "npm pack must return the skillar archive");
assert.ok(archive.files.some(file => file.path === "NOTICE"));
assert.equal(archive.files.some(file => /(?:__gallery|p1-gallery|p1-gate|mit-entry|widget-reference)/.test(file.path)), false);
const notice = await readFile(`${root}/THIRD_PARTY_NOTICES.md`, "utf8");
assert.equal(await readFile(`${root}/local/NOTICE`, "utf8"), notice);
assert.equal(await readFile(`${root}/site/dist/NOTICE`, "utf8"), notice);
const artifacts = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await inspect(path);
    else if (/\.(?:js|css|html)$/.test(path)) {
      const bytes = await readFile(path), source = bytes.toString();
      assert.equal(/(?:P1Gallery|mit-ready|lf-gallery--atomic|data-specimen)/.test(source), false, path);
      artifacts.push({ path, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
    }
  }
}
await inspect(`${root}/site/dist`); await inspect(`${root}/local/dist/dashboard`);
await writeFile(`${out}/release.json`, JSON.stringify({
  status: "PASS", noticeInPack: true, shippedNoticesEqualSource: true, noGalleryOrQAModules: true, artifacts,
}, null, 2));
console.log(`P1_RELEASE_PASS ${artifacts.length} artifacts, ${archive.files.length} package files`);
