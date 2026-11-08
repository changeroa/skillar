import assert from "node:assert/strict";
import test from "node:test";
import { createPrivateSkillPackage } from "../../../shared/dist/private-skill-package.js";
import { SkillsApp } from "./app.ts";
import { routes } from "./api.ts";
import { act, all, buttonNamed, h, mount, waitFor } from "../../test/helpers/t10-dom.mjs";

const skillId = "11223344-1122-4122-8122-112233445566";
const pkg = await createPrivateSkillPackage([{
  path: "SKILL.md", mediaType: "text/markdown",
  bytes: new TextEncoder().encode("---\nname: fixture\ndescription: fixture\n---\nbody"),
}]);
const skill = { skillId, name: "resolved entity", description: "fixture",
  head: { digest: pkg.manifestDigest, revision: 1 }, updatedAt: 1800000000000 };
const detail = { skill, versions: [{ digest: pkg.manifestDigest, pinned: false, createdAt: 1800000000000 }] };
const exported = { skillId, version: detail.versions[0], package: pkg };
const session = { user: { sub: "fixture", email: "fixture@example.test", name: "fixture",
  picture: "", createdAt: 1, lastLogin: 1 } };

function Shell(props) {
  globalThis.document.querySelector = selector => selector.startsWith("#skills-page-title")
    ? globalThis.document.getElementById("skills-page-title") : null;
  return h("div", null, h("h1", { id: "skills-page-title" }, "스킬"), h(SkillsApp, props));
}

async function app(t, catalog) {
  const events = new EventTarget();
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.location = { origin: "https://skillar.sh", pathname: "/skills/",
    hash: `#skill/${skillId}`, href: `https://skillar.sh/skills/#skill/${skillId}` };
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "/auth/session") return Response.json(session);
    if (url === routes.catalog) return catalog();
    if (url === routes.skill(skillId)) return Response.json(detail);
    if (url === routes.version(skillId, pkg.manifestDigest)) return Response.json(exported);
    throw new Error(`Unexpected request: ${url}`);
  });
  return mount(t, Shell, { signal: new AbortController().signal });
}

test("successful detail owns the entity h1 when the catalog fails and remains stable through catalog retry", async t => {
  // Given
  let reads = 0;
  const { dom, container } = await app(t, () => ++reads === 1
    ? Response.json({ error: "unavailable" }, { status: 503 })
    : Response.json({ revision: 1, skills: [{ ...skill, name: "stale catalog name" }] }));
  await waitFor(dom, () => dom.getElementById("edit-skill-document") && buttonNamed(container, "다시 시도")[0], "detail with catalog failure");
  assert.equal(dom.getElementById("skills-page-title").textContent, detail.skill.name);
  const editor = dom.getElementById("edit-skill-document");
  // When
  await act(() => buttonNamed(container, "다시 시도")[0].click());
  await waitFor(dom, () => all(container, node => node.id === `skill-row-${skillId}`).length === 1, "catalog recovery");
  // Then
  assert.equal(dom.getElementById("skills-page-title").textContent, detail.skill.name);
  assert.equal(dom.getElementById("edit-skill-document") === editor, true);
  assert.equal(reads, 2);
});

test("a successful catalog cannot replace the resolved detail name", async t => {
  // Given
  const { dom } = await app(t, () => Response.json({
    revision: 1, skills: [{ ...skill, name: "older catalog snapshot" }],
  }));
  // When
  await waitFor(dom, () => dom.getElementById("edit-skill-document"), "resolved detail");
  // Then
  assert.equal(dom.getElementById("skills-page-title").textContent, detail.skill.name);
});
