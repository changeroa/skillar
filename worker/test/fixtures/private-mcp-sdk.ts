// SPDX-License-Identifier: AGPL-3.0-only
// SDK conformance fixture only: no OAuth verifier or production catalog.
import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { SkillsExtension, memorySkillFiles } from "@modelcontextprotocol/server/ext/skills";
import { z } from "zod";

const catalog = SkillsExtension.load(memorySkillFiles({
  "alpha/SKILL.md": "---\nname: alpha\ndescription: SDK gate alpha\n---\nAlpha body.\n",
  "alpha/references/guide.txt": "Supporting text.\n",
  "alpha/data.bin": new Uint8Array([0, 255, 128, 1]),
  "beta/SKILL.md": "---\nname: beta\ndescription: SDK gate beta\n---\nBeta body.\n",
}), {
  prefix: "sdk-gates", pageSize: 1, strict: true,
  cacheHint: { ttlMs: 30_000, cacheScope: "private" },
});

const handler = createMcpHandler(async () => {
  const server = new McpServer({ name: "sdk-gates", version: "1.0.0" }, {
    instructions: "SDK compatibility fixture.",
  });
  server.registerTool("search_skills", {
    inputSchema: z.object({ query: z.string().max(2048) }),
  }, async ({ query }) => ({
    content: [{ type: "text", text: JSON.stringify({ query, fixture: true }) }],
  }));
  server.registerResource("fixture-info", "fixture://info", { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "SDK fixture.\n" }] }));
  (await catalog).attach(server);
  return server;
}, {
  // Miniflare's HTTP bridge supplies the loopback Host even for a logical sdk.test URL.
  allowedHostnames: ["sdk.test", "127.0.0.1"],
  allowedOriginHostnames: ["sdk.test"],
  corsOptions: false,
  keepAliveMs: 0,
});

export default {
  fetch(request: Request) {
    return handler.fetch(request);
  },
};
