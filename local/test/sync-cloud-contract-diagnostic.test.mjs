import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";
import { distImport } from "./_helpers.mjs";
import { fixture, grant } from "./helpers/sync-cloud.mjs";

const { runCloudStep } = await distImport("sync/cloud.js");
const { contractDiagnostic } = await distImport("sync/contract-diagnostic.js");

test("contractDiagnostic keeps schema paths and issue kinds, never values or dynamic keys", () => {
  const schema = z.strictObject({
    consent: z.strictObject({ contentKinds: z.array(z.string()) }),
    rows: z.array(z.record(z.string(), z.number())),
  });
  const parsed = schema.safeParse({
    consent: { contentKinds: "PROMPT_BODY_SECRET" },
    rows: [{ "/Users/iyee/Private/secret.md": "not-a-number" }],
    unexpected: "EXTRA_VALUE_SECRET",
  });
  assert.equal(parsed.success, false);
  const code = contractDiagnostic(parsed.error);
  assert.match(code, /^invalid_contract:/);
  assert.match(code, /consent\.contentKinds:invalid_type/);
  assert.match(code, /extra_keys:unexpected/);
  for (const leaked of ["PROMPT_BODY_SECRET", "EXTRA_VALUE_SECRET", "secret.md", "/Users", "not-a-number"]) {
    assert.ok(!code.includes(leaked), `diagnostic must not contain ${leaked}: ${code}`);
  }
});

test("quarantine from a schema-violating devices/self names the path without the value", async t => {
  const f = await fixture(t);
  await f.setConsent(grant(null));
  const step = options => runCloudStep(f.home, f.source, options);
  assert.equal((await step({ fetcher: f.fetcher })).phase, "queued");
  const poisoned = async (url, init) => {
    const response = await f.fetcher(url, init);
    if (new URL(url).pathname !== "/v1/devices/self") return response;
    const body = await response.json();
    body.consent = { ...body.consent, contentKinds: "PROMPT_BODY_SECRET" };
    return Response.json(body);
  };
  const progress = await step({ fetcher: poisoned });
  assert.equal(progress.phase, "quarantine");
  assert.match(progress.code, /^invalid_contract:/);
  assert.match(progress.code, /consent\.contentKinds:invalid_type/);
  assert.ok(!progress.code.includes("PROMPT_BODY_SECRET"));
  assert.equal(progress.attempts, 0);
  const saved = JSON.parse(readFileSync(join(f.home, "cloud", "status.json"), "utf8"));
  assert.equal(saved.code, progress.code);
  assert.equal(saved.phase, "quarantine");
});
