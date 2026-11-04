// Synthetic browser QA only. No credentials, owner data, or production services.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createPrivateSkillPackage } from "../../../shared/dist/private-skill-package.js";

const skillId = "11223344-1122-4122-8122-112233445566";
const packages = await Promise.all(["Earlier fixture", "Current fixture"].map(body =>
  createPrivateSkillPackage([{ path: "SKILL.md", mediaType: "text/markdown",
    bytes: new TextEncoder().encode(`---\nname: synthetic\ndescription: Synthetic deletion control QA\n---\n${body}\n`) }])));
const older = packages[0].manifestDigest, current = packages[1].manifestDigest;
const dist = new URL("../../../site/dist/", import.meta.url);
let exists, revision, versions, deletes, hold = false, pending = [];
let deleteObservers = [];
const reset = () => {
  exists = true; revision = 2; deletes = [];
  versions = packages.map(value => ({ digest: value.manifestDigest, createdAt: 1_800_000_000_000, pinned: false })).reverse();
};
reset();
const skill = () => ({
  skillId, name: "synthetic", description: "Synthetic deletion control QA",
  head: { digest: current, revision }, updatedAt: 1_800_000_000_000,
});
const detail = () => ({ skill: skill(), versions });
const json = (response, value, status = 200) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
};
const body = async request => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};
function finishDelete(response, path, input, fail = false) {
  if (fail || input.base?.digest !== current || input.base.revision !== revision) {
    return json(response, { error: "head_conflict" }, 409);
  }
  if (path === `/api/skills/${skillId}`) {
    exists = false;
    return json(response, { deleted: true });
  }
  const digest = path.split("/").at(-1);
  if (digest === current) return json(response, { error: "version_protected" }, 409);
  versions = versions.filter(version => version.digest !== digest);
  revision++;
  return json(response, detail());
}
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path === "/qa/next-delete") {
      deleteObservers.push(response);
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.flushHeaders();
      response.once("close", () => { deleteObservers = deleteObservers.filter(entry => entry !== response); });
      return;
    }
    if (path === "/qa/state") return json(response, { exists, revision, versions, deletes, pending: pending.length, older, current, skillId });
    if (path === "/qa/control" && request.method === "POST") {
      const input = await body(request);
      if (input.release) {
        const held = pending; pending = [];
        for (const entry of held) finishDelete(entry.response, entry.path, entry.input, input.fail);
      }
      if (input.reset) {
        for (const entry of pending) json(entry.response, { error: "head_conflict" }, 409);
        pending = []; reset();
      }
      hold = input.hold ?? false;
      return json(response, { ready: true });
    }
    if (path === "/auth/session") return json(response, { user: {
      sub: "synthetic-qa", email: "qa@example.test", name: "Fixture account", picture: "", createdAt: 0, lastLogin: 0,
    } });
    if (path === "/api/skills") return json(response, { revision, skills: exists ? [skill()] : [] });
    if (path === `/api/skills/${skillId}` && request.method === "GET") {
      return json(response, exists ? detail() : { error: "not_found" }, exists ? 200 : 404);
    }
    if (path.startsWith(`/api/skills/${skillId}`) && request.method === "DELETE") {
      const input = await body(request);
      deletes.push({ path, body: input });
      const observers = deleteObservers; deleteObservers = [];
      for (const observer of observers) observer.end(JSON.stringify({ count: deletes.length, path }));
      if (hold) pending.push({ response, path, input });
      else finishDelete(response, path, input);
      return;
    }
    if (path.startsWith(`/api/skills/${skillId}/versions/`)) {
      const digest = path.split("/").at(-1), index = packages.findIndex(value => value.manifestDigest === digest);
      if (index < 0) return json(response, { error: "not_found" }, 404);
      return json(response, { skillId, version: { digest, createdAt: 1_800_000_000_000, pinned: false }, package: packages[index] });
    }
    const relative = path === "/skills/" || path === "/skills" ? "skills/index.html" : path.slice(1);
    const file = new URL(relative, dist);
    if (!file.pathname.startsWith(dist.pathname)) return json(response, { error: "not_found" }, 404);
    const bytes = await readFile(file);
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
      ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" }[extname(file.pathname)] ?? "application/octet-stream";
    response.writeHead(200, { "content-type": mime }); response.end(bytes);
  } catch (error) {
    if (error instanceof Error) json(response, { error: "fixture_not_found" }, 404);
    else throw error;
  }
});
server.listen(0, "127.0.0.1", () => console.log(`P14_SKILLS_QA_READY http://127.0.0.1:${server.address().port}`));
function close() {
  for (const observer of deleteObservers) observer.end(JSON.stringify({ closed: true }));
  for (const entry of pending) json(entry.response, { error: "fixture_closed" }, 503);
  server.closeAllConnections();
  server.close();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
