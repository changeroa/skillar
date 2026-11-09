import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "../../site/node_modules/zod/index.js";
import { metricFailures } from "./metrics.mjs";
import { diffImages } from "./image-diff.mjs";

const captureSchema = z.object({ results: z.array(z.object({
  page: z.string(), profile: z.string(), theme: z.enum(["light", "dark"]),
  state: z.string(), file: z.string(),
  crop: z.object({ dpr: z.number().positive() }),
  actual: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
})) });
const [input, referenceId, targetIds, output, cornerTolerance = "0"] = process.argv.slice(2);
const rasterTolerance = z.coerce.number().int().min(0).max(8).parse(cornerTolerance);
if (!input || !referenceId || !targetIds || !output || !process.env.OMOWRIGHT_HELPER)
  throw Error("Usage: OMOWRIGHT_HELPER=... node compare.mjs results.json referenceId targetId[,targetId] output");
const captures = captureSchema.parse(JSON.parse(await readFile(input, "utf8"))).results;
const targets = new Set(targetIds.split(","));
const references = new Map(captures.filter(c => c.page === referenceId).map(c =>
  [`${c.profile}/${c.theme}/${c.state}`, c]));
const { loadOmowright } = await import(pathToFileURL(resolve(process.env.OMOWRIGHT_HELPER)).href);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const tab = await tabs.create("about:blank");
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const actual of captures.filter(c => targets.has(c.page))) {
    const reference = references.get(`${actual.profile}/${actual.theme}/${actual.state}`);
    if (!reference) throw Error(`Missing reference for ${actual.page}/${actual.state}`);
    const id = `${actual.page}-${actual.profile}-${actual.theme}-${actual.state}`;
    const metrics = metricFailures(actual.actual, reference.actual);
    const comparison = await diffImages(tab.page, {
      reference: reference.file, actual: actual.file,
      sideBySide: join(output, `${id}-side.png`), diff: join(output, `${id}-diff.png`),
      cornerTolerance: rasterTolerance, cornerInset: 4 * actual.crop.dpr,
      cornerRadius: Number(actual.actual.radius) * actual.crop.dpr,
    });
    const pass = metrics.length === 0 && comparison.dimensionsMatch && comparison.diffPixels === 0;
    results.push({ id, reference: reference.file, actual: actual.file, metrics, comparison, pass });
    console.log(`${pass ? "PASS" : "FAIL"} ${id} pixels=${comparison.diffPixels} metrics=${metrics.length}`);
  }
} finally {
  const summary = { comparisons: results.length, passed: results.filter(r => r.pass).length,
    failed: results.filter(r => !r.pass).length,
    rawDifferingPixels: results.reduce((n, r) => n + r.comparison.rawDiffPixels, 0),
    acceptedCornerPixels: results.reduce((n, r) => n + r.comparison.acceptedCornerPixels, 0),
    maxPerChannelDelta: [0, 1, 2, 3].map(c =>
      Math.max(0, ...results.map(r => r.comparison.maxPerChannelDelta[c]))),
    maxChannelDelta: Math.max(0, ...results.map(r => r.comparison.maxChannelDelta)) };
  await writeFile(join(output, "results.json"), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary));
  await tabs.closeAll();
  await browser.close();
}
if (!results.length || results.some(result => !result.pass)) process.exitCode = 1;
