// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { createPrivateSkillPackage } from "../../shared/dist/private-skill-package.js";
import { origin } from "./helpers/private-mcp-auth.mjs";
import { createPrivateMcpNativeFixture as fixture, skillId } from "./helpers/private-mcp-native.mjs";

test("consented omo observations retain per-call identity without changing the connection trace", async t => {
  const f = await fixture(t);
  const encode = text => new TextEncoder().encode(text);
  const value = await createPrivateSkillPackage([
    { path: "SKILL.md", mediaType: "text/markdown",
      bytes: encode("---\nname: quartz\ndescription: Deploy quartz services\n---\nQuartz instructions.\n") },
    { path: "guide.md", mediaType: "text/markdown", bytes: encode("quartz guide") },
  ]);
  assert.equal((await f.publish(value)).status, 200);
  const { token, connection } = await f.pat(true);
  const root = `skill://private/${skillId}/${value.manifestDigest}`;
  const first = "01a20c03-8272-7fb9-b1df-3172507a9bbd";
  const second = "01a20c03-8272-7fb9-b1df-3172507a9bbe";
  const _meta = { "io.modelcontextprotocol/clientInfo": { name: "senpi-mcp-client", version: "0.0.0" } };
  const headers = { "X-Skillar-Omo-Session-Id": second };
  const search = await f.mcp(token, "tools/call", { name: "search_skills", arguments: { query: "quartz" }, _meta });
  const load = await f.mcp(token, "resources/read", { uri: `${root}/SKILL.md`, _meta: { ..._meta, sessionId: first } }, { headers });
  const read = await f.mcp(token, "resources/read", { uri: `${root}/guide.md` }, { legacy: true, headers });
  for (const response of [search, load, read]) {
    assert.equal(response.status, 200);
    assert.equal(response.body.error, undefined);
  }
  const result = await f.rawForward("observations", origin);
  assert.equal(result.status, 200);
  const rows = (await result.json()).map(({ values }) => {
    const { conversationId } = JSON.parse(values.data_json);
    return [values.session_id, values.kind, values.runtime, values.attribution_method, conversationId];
  });
  assert.deepEqual(rows, [
    [connection.connectionId, "search", "omo", "runtime_id", undefined],
    [connection.connectionId, "load", "omo", "vendor_meta", first],
    [connection.connectionId, "read_file", "omo", "vendor_meta", second],
  ]);
});
