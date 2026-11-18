import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PACKAGE_ROOT, distImport } from "./_helpers.mjs";
import { join } from "node:path";
import { bearer, http, startTestServer } from "./helpers/api.mjs";
import { descendants, installDom } from "./helpers/dashboard-dom.mjs";
import { seedEvidence } from "./helpers/dashboard-evidence.mjs";

// Mutate the actual bundled component code, not fixture values or expected assertions.
export const mutations = {
  ranks: ["skill.rankInSearch}", "999}"],
  unranked: ['skill.rankInSearch ?? "not_in_results"', 'skill.rankInSearch ?? 0'],
  candidates: ["candidate.copies}", "999}"],
  abstention: ["abstention.reason}", '"mutated"}'],
  native: ["finding.nativeWithoutSearch}", "false}"],
  missed: ["finding.missedLater.map", "[].map"],
  correction: ["correction.status}", '"unknown"}'],
  correctionBasis: ["correction.label}", '"reported"}'],
  unknownCorrection: ['correction.reason ?? "none"', '"mutated"'],
  reads: ["read.eventId}", '"mutated"}'],
  readBasis: ["read.label}", '"unknown"}'],
  readPath: ['typeof event?.data.uri === "string" ? event.data.uri', 'typeof event?.data.uri === "string" ? "mutated"'],
  unresolvedCount: ["data-unattributed-count={loads.count}", "data-unattributed-count={0}"],
  unresolvedUris: ["loads.uris.map", "[].map"],
};

const mutation = process.env.SKILLAR_DASHBOARD_MUTATION;
const reword = process.env.SKILLAR_DASHBOARD_REWORD === "1";
const bundled = await build({
  stdin: {
    contents: 'export * from "./dashboard/components/skill-evidence.tsx"; export {createElement as h} from "react"; export {render} from "./dashboard/react-mount";',
    resolveDir: fileURLToPath(PACKAGE_ROOT), loader: "tsx",
  },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", jsxImportSource: "react", logLevel: "silent",
  plugins: mutation || reword ? [{
    name: "regression-mutation",
    setup(build) {
      build.onLoad({ filter: /skill-evidence\.tsx$/ }, async ({ path }) => {
        const replacements = mutation ? [mutations[mutation]] : [
          ['"not in results (or no preceding search)"', '"absent from the preceding search"'],
          ['"next prompt text not captured"', '"following prompt content unavailable"'],
          ['"no next prompt observed"', '"following prompt unavailable"'],
        ];
        const source = await readFile(path, "utf8");
        if (reword && path.endsWith("skill-evidence.tsx")) {
          const count = replacements.filter(([from]) => source.includes(from)).length;
          assert.equal(count, 3, "the probe must reword all three display strings");
          console.log(`Reword probe: replaced ${count} display strings; semantic values unchanged.`);
        }
        return { contents: replacements.reduce((text, [from, to]) => text.replaceAll(from, to), source), loader: "tsx" };
      });
    },
  }] : [],
});
// Load before installing the DOM: view-local styles are a browser concern.
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const newRoot = installDom();
let server, fixture, report;
const reports = {};
before(async () => {
  server = await startTestServer();
  fixture = seedEvidence(server.skillarHome);
  const get = async (path) => {
    const response = await http(server.port, { path, headers: bearer(server.token) });
    assert.equal(response.status, 200);
    return response.json;
  };
  report = await get(`/api/flows/${fixture.flowId}`);
  for (const [key, id] of Object.entries(fixture.ids)) reports[key] = await get(`/api/sessions/${id}/skill-report`);
});
after(async () => { if (server) await server.stop(); delete globalThis.document; delete globalThis.HTMLDetailsElement; });

function render(Component, props) {
  const root = newRoot();
  ui.render(ui.h(Component, props), root);
  return root;
}
function attr(root, name, value) {
  const found = descendants(root).find((node) => node.getAttribute(name) === String(value));
  assert.ok(found, `${name}=${value} in ${root.textContent}`);
  return found;
}
const finding = (index = 0) => reports.evidence.finding.turns[index];
const findingView = (index = 0) => render(ui.FindingEvidence, { finding: finding(index) });

function usageView(name, index = 0) {
  const session = reports.evidence;
  const turn = session.tree.turns[index];
  const span = session.usage.spans.find((item) => item.name === name && item.turnId === turn.id);
  assert.ok(span);
  return render(ui.UsageEvidence, { usage: span, events: turn.events });
}

for (const scope of ["flow", "session"]) test(`${scope} unresolved loads render the real API count and every affected URI`, () => {
  // Given the corresponding real report, including its unresolved attribution population.
  const loads = (scope === "flow" ? report : reports.evidence).unattributedLoads;
  assert.equal(loads.count, 2);
  assert.equal(loads.uris.length, 2);
  // When the shared production disclosure renders it.
  const root = render(ui.UnresolvedLoadNotice, { loads });
  // Then its uncertainty, count and complete URI set have machine-readable semantics.
  attr(root, "data-load-attribution", "unresolved");
  attr(root, "data-unattributed-count", 2);
  assert.deepEqual(descendants(root).flatMap((node) => node.getAttribute("data-unattributed-uri") ?? []), loads.uris);
});

test("a zero unresolved-load count renders no uncertainty disclosure", () => {
  const root = render(ui.UnresolvedLoadNotice, { loads: { count: 0, uris: [] } });
  assert.equal(descendants(root).some((node) => node.getAttribute("data-load-attribution") !== null), false);
});

test("lower-ranked loaded skill retains its machine rank and rendered value", () => {
  const node = attr(findingView(), "data-used-skill", "lower");
  assert.equal(node.getAttribute("data-rank"), "2");
  assert.match(node.textContent, /순위 2/);
});
test("candidate copies expose collapsed rank and original rank", () => {
  const root = findingView();
  const copy = attr(root, "data-candidate", finding().candidates.find((item) => item.name === "first-copy").uri);
  assert.equal(copy.getAttribute("data-rank"), "1");
  assert.equal(copy.getAttribute("data-raw-rank"), "2");
  assert.equal(copy.getAttribute("data-copies"), "2");
  assert.match(copy.textContent, /복사본 2개/);
});
test("abstention preserves its reported reason and query", () => {
  const root = findingView(1);
  assert.match(attr(root, "data-abstention", "below_threshold").textContent, /below_threshold/);
  assert.match(root.textContent, /missing specialist/);
});
test("native-before-search remains visible when another finding label wins", () => {
  assert.equal(finding().label, "found_lower");
  attr(findingView(), "data-native-without-search", "true");
});
test("out-of-results use does not invent a rank", () => {
  const node = attr(findingView(1), "data-used-skill", "outside");
  assert.equal(node.getAttribute("data-rank"), "not_in_results");
  assert.equal(node.getAttribute("data-via"), "load");
});
test("correction status exposes matched terms and heuristic basis", () => {
  const node = attr(usageView("lower"), "data-correction", "correction");
  assert.equal(node.getAttribute("data-basis"), "heuristic");
  assert.match(node.textContent, /wrong/);
});
test("uncaptured next prompt remains unknown with heuristic basis", () => {
  const node = attr(usageView("outside", 1), "data-correction", "unknown");
  assert.equal(node.getAttribute("data-basis"), "heuristic");
  assert.equal(node.getAttribute("data-correction-reason"), "text_not_captured");
});
test("absent next prompt stays unknown rather than no correction", () => {
  const node = attr(usageView("later-missed", 2), "data-correction", "unknown");
  assert.equal(node.getAttribute("data-basis"), "heuristic");
  assert.equal(node.getAttribute("data-correction-reason"), "no_next_prompt");
});
test("reported supporting read shows actual resource and event provenance", () => {
  const root = usageView("lower");
  const read = reports.evidence.usage.spans.find((span) => span.name === "lower").supportingReads[0];
  const node = attr(root, "data-read", read.eventId);
  assert.equal(node.getAttribute("data-basis"), "reported");
  assert.match(node.textContent, /skill:\/\/agents\/lower\/reference\.md/);
  assert.ok(node.textContent.includes(read.eventId));
});
test("heuristic supporting read shows the tool argument and event", () => {
  const root = usageView("native-before");
  const read = reports.evidence.usage.spans.find((span) => span.name === "native-before").supportingReads[0];
  const node = attr(root, "data-read", read.eventId);
  assert.equal(node.getAttribute("data-basis"), "heuristic");
  assert.match(node.textContent, /\/skills\/native-before\/reference\.md/);
});
