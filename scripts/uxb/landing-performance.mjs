import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const [mode, output, origin = "http://127.0.0.1:5186"] = process.argv.slice(2);
const auditModules = process.env.AUDIT_MODULES ?? "/tmp/skillar-pr9-audit/node_modules";
const { default: lighthouse } = await import(pathToFileURL(join(auditModules, "lighthouse/core/index.js")).href);
const { default: desktop } = await import(pathToFileURL(join(auditModules, "lighthouse/core/config/desktop-config.js")).href);
const { default: puppeteer } = await import(pathToFileURL(join(auditModules, "puppeteer-core/lib/puppeteer/puppeteer-core.js")).href);
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333" });
const page = await browser.newPage();
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const profile of ["mobile", "desktop"]) for (const theme of ["light", "dark"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
    await page.evaluateOnNewDocument(value => localStorage.setItem("skillar-theme", value), theme);
    for (let run = 0; run < 3; run++) {
      const { lhr } = await lighthouse(origin, { disableStorageReset: true, logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      }, profile === "desktop" ? desktop : undefined, page);
      assert.equal(lhr.runtimeError, undefined, JSON.stringify(lhr.runtimeError));
      await writeFile(join(output, `${mode}-${profile}-${theme}-${run}.json`), JSON.stringify(lhr, null, 2));
      const scores = Object.fromEntries(Object.entries(lhr.categories).map(([key, value]) => [key, value.score * 100]));
      const metrics = Object.fromEntries(["first-contentful-paint", "largest-contentful-paint",
        "total-blocking-time", "cumulative-layout-shift", "speed-index"].map(key => [key, lhr.audits[key].numericValue]));
      results.push({ profile, theme, run, scores, metrics, browser: lhr.environment.hostUserAgent });
      console.log(`AUDIT ${mode} ${profile} ${theme} ${run} ${JSON.stringify(scores)}`);
    }
  }
} finally {
  await writeFile(join(output, `${mode}-runs.json`), JSON.stringify(results, null, 2));
  await page.close(); await browser.disconnect();
}
const median = values => [...values].sort((a, b) => a - b)[1];
const summary = [];
for (const profile of ["mobile", "desktop"]) for (const theme of ["light", "dark"]) {
  const group = results.filter(result => result.profile === profile && result.theme === theme);
  assert.equal(group.length, 3);
  summary.push({ profile, theme,
    scores: Object.fromEntries(Object.keys(group[0].scores).map(key => [key, median(group.map(result => result.scores[key]))])),
    metrics: Object.fromEntries(Object.keys(group[0].metrics).map(key => [key, median(group.map(result => result.metrics[key]))])),
  });
}
const assets = [];
for (const file of await readdir("site/dist", { recursive: true })) {
  if (!/\.(?:css|js)$/.test(file)) continue;
  const bytes = await readFile(join("site/dist", file));
  assets.push({ file, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length });
}
await writeFile(join(output, `${mode}.json`), JSON.stringify({ summary, assets }, null, 2));
if (mode === "after") {
  const before = JSON.parse(await readFile(join(output, "before.json"), "utf8"));
  for (const row of summary) {
    const baseline = before.summary.find(value => value.profile === row.profile && value.theme === row.theme);
    for (const key of Object.keys(row.scores))
      assert.ok(row.scores[key] >= baseline.scores[key] - 1, `${row.profile}/${row.theme}/${key}: score regression`);
    for (const key of ["first-contentful-paint", "largest-contentful-paint", "speed-index"])
      assert.ok(row.metrics[key] <= baseline.metrics[key] * 1.1 + 100, `${row.profile}/${row.theme}/${key}: exceeds noise budget`);
    assert.ok(row.metrics["cumulative-layout-shift"] <= baseline.metrics["cumulative-layout-shift"] + .01);
    assert.ok(row.metrics["total-blocking-time"] <= baseline.metrics["total-blocking-time"] + 50);
  }
}
console.log(`AUDIT_COMPLETE ${mode}`);
