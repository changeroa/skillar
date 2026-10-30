import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const server = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const schema = z.object({ skills: z.array(z.object({ uri: z.string() })) });
test("named roots preserve skillar URIs across path and root-order changes", async t => {
  const root = await mkdtemp(join(tmpdir(), "skillar-named-roots-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["release one/alpha", "codex/beta"]) {
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, dir, "SKILL.md"), `---\nname: ${dir.split("/").at(-1)}\ndescription: Root identity fixture\n---\nBody\n`);
  }
  await symlink(join(root, "release one"), join(root, "current"));
  const read = async config => {
    const client = new Client({ name: "named-roots-test", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, SKILLAR_ROOT: join(root, "runtime"), SKILLAR_SKILL_ROOTS: config, SKILLAR_SKILLS_DIRS: "/ignored-legacy-root" }, stderr: "pipe" });
    let stderr = ""; transport.stderr.on("data", bytes => { stderr += bytes; });
    try {
      await client.connect(transport);
      const result = await client.request({ method: "skills/list", params: {} }, schema);
      assert.match(stderr, /deprecated and ignored/);
      const uri = "skill://skillar/iyen/alpha/SKILL.md";
      assert.match((await client.readResource({ uri })).contents[0].text, /Root identity fixture/);
      return result.skills.map(skill => skill.uri).sort();
    } finally { await client.close(); }
  };
  const expected = ["skill://skillar/codex/beta/SKILL.md", "skill://skillar/iyen/alpha/SKILL.md"];
  assert.deepEqual(await read(`iyen=${root}/release one;codex=${root}/codex`), expected);
  assert.deepEqual(await read(`codex=${root}/codex;iyen=${root}/current`), expected, "a symlink root and reordered config retain the same URI");
});

test("invalid named roots fail instead of silently changing URI identities", () => {
  for (const config of ["", "skillar=relative", "skillar=/a;skillar=/b", "../escape=/a", "skillar=/a;", "missing-separator"]) {
    const result = spawnSync(process.execPath, [server], { env: { ...process.env, SKILLAR_SKILL_ROOTS: config }, encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 1, config);
    assert.match(result.stderr, /SKILLAR_SKILL_ROOTS requires unique URI-safe ids/, config);
  }
});

test("legacy resources_read enforces URI and realpath boundaries", async t => {
  const root = await mkdtemp(join(tmpdir(), "skillar-legacy-boundaries-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skills = join(root, "skills");
  await mkdir(join(skills, "alpha"), { recursive: true });
  await mkdir(join(skills, "alpha-sibling"), { recursive: true });
  await mkdir(join(root, "outside"), { recursive: true });
  await writeFile(join(skills, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Fixture\n---\n");
  await writeFile(join(skills, "alpha", "encoded name.txt"), "inside");
  await writeFile(join(skills, "alpha-sibling", "secret.txt"), "sibling");
  await writeFile(join(root, "outside", "secret.txt"), "outside");
  await symlink(join(root, "outside", "secret.txt"), join(skills, "alpha", "linked.txt"));
  await symlink(join(root, "outside"), join(skills, "alpha", "linked-dir"));
  await symlink(join(skills, "alpha-sibling", "secret.txt"), join(skills, "alpha", "sibling.txt"));
  await symlink(join(root, "outside"), join(skills, "escaped-skill"));
  await symlink(join(skills, "alpha", "encoded name.txt"), join(skills, "alpha", "inside-link.txt"));
  await symlink(skills, join(root, "current"));
  const client = new Client({ name: "legacy-boundaries-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: {
      ...process.env,
      SKILLAR_ROOT: join(root, "runtime"),
      SKILLAR_STATE_DIR: join(root, "state"),
      SKILLAR_SKILL_ROOTS: `fixture=${join(root, "current")}`,
      SKILLAR_URI_AUTHORITY: "skillar",
    },
  });
  t.after(() => client.close());
  await client.connect(transport);
  const prefix = "skill://skillar/fixture/alpha";
  for (const [name, uri] of [
    ["escaping file symlink", `${prefix}/linked.txt`],
    ["escaping directory symlink", `${prefix}/linked-dir/secret.txt`],
    ["sibling-prefix symlink", `${prefix}/sibling.txt`],
    ["escaping skill symlink", "skill://skillar/fixture/escaped-skill/secret.txt"],
    ["foreign authority", "skill://different-authority/fixture/alpha/SKILL.md"],
    ["credentials", "skill://user:pass@skillar/fixture/alpha/SKILL.md"],
    ["query", `${prefix}/SKILL.md?other=1`],
    ["fragment", `${prefix}/SKILL.md#other`],
    ["dot traversal", `${prefix}/../alpha-sibling/secret.txt`],
    ["encoded dot traversal", `${prefix}/%2e%2e/alpha-sibling/secret.txt`],
    ["encoded slash traversal", `${prefix}/..%2falpha-sibling%2fsecret.txt`],
    ["encoded absolute path", `${prefix}/${encodeURIComponent(join(root, "outside", "secret.txt"))}`],
    ["absolute path", join(root, "outside", "secret.txt")],
    ["malformed encoding", `${prefix}/%ZZ`],
    ["encoded NUL", `${prefix}/%00`],
  ]) {
    await t.test(`rejects ${name}`, async () => {
      const result = await client.callTool({ name: "resources_read", arguments: { uri } });
      assert.equal(result.isError, true, `must reject ${uri}`);
    });
  }
  for (const resource of ["encoded%20name.txt", "inside-link.txt"]) {
    await t.test(`reads safe ${resource} through a symlinked root`, async () => {
      const result = await client.callTool({ name: "resources_read", arguments: { uri: `${prefix}/${resource}` } });
      assert.notEqual(result.isError, true);
      assert.equal(JSON.parse(result.content[0].text).text, "inside");
    });
  }
});
