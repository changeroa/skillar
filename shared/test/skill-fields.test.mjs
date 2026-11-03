import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFields, splitSkillMarkdown } from "../dist/skill-fields.js";

test("private publication extracts the same routing fields without interpreting metadata", () => {
  // Given
  const input = "---\nname: fixture\ndescription: Synthetic fixture\naliases_ko: [자료]\n" +
    "disable-model-invocation: true\nmetadata:\n  io.modelcontextprotocol/private: opaque\n---\n" +
    "# Heading\n\n```sh\nnot executed\n```\n\nRouting paragraph.\n";
  // When
  const parsed = splitSkillMarkdown(input, { rejectAliases: true });
  const fields = extractFields(parsed.frontmatter, parsed.body);
  // Then
  assert.equal(fields.invocation, "explicit");
  assert.deepEqual(fields.aliasesKo, ["자료"]);
  assert.equal(fields.bodyHead, "Routing paragraph.");
  assert.equal(parsed.frontmatter.metadata["io.modelcontextprotocol/private"], "opaque");
});

test("remote parsing refuses aliases while the local parser retains its existing alias policy", () => {
  // Given
  const input = "---\nname: fixture\ndescription: &description Synthetic fixture\n" +
    "when_to_use: *description\n---\nBody\n";
  // When
  const local = splitSkillMarkdown(input);
  const remote = splitSkillMarkdown(input, { rejectAliases: true });
  // Then
  assert.equal(local.frontmatter.when_to_use, "Synthetic fixture");
  assert.equal(remote.frontmatter, null);
});

test("a cyclic YAML alias is not a valid remote frontmatter object", () => {
  // Given
  const input = "---\nname: fixture\ndescription: Synthetic\nmetadata: &loop\n  child: *loop\n---\nBody";
  // When
  const remote = splitSkillMarkdown(input, { rejectAliases: true });
  // Then
  assert.equal(remote.frontmatter, null);
});
