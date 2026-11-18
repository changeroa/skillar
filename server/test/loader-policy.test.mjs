import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const loaders = [
  "clients/codex/skillar/SKILL.md",
  "clients/gajae-code/plugin/prompts/discovery.md",
  "clients/gajae-code/plugin/subskills/interview/SKILL.md",
  "clients/oh-my-openagent/extension/discovery.md",
  "clients/oh-my-openagent/skillar/SKILL.md",
  "clients/openclaw/plugin/hooks/skillar-discovery/handler.js",
  "clients/openclaw/plugin/skills/skillar/SKILL.md",
  "plugins/skillar/skills/skillar/SKILL.md",
];

test("owned loader discovery surfaces use the explicit mode token", async () => {
  const bodies = new Map(await Promise.all(loaders.map(async file => [file, await readFile(new URL(file, root), "utf8")])));
  for (const [file, body] of bodies) assert.match(body, /\bmode:\s*discovery\b/, file);
});
