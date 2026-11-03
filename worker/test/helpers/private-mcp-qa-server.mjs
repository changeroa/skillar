// SPDX-License-Identifier: AGPL-3.0-only
// Disposable localhost QA host: real Pages bridges and native AS/RS/D1/R2/DO.
// The only login is the explicitly synthetic Google session in the native fixture.
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { Readable } from "node:stream";
import { createPrivateMcpNativeFixture } from "./private-mcp-native.mjs";
import { origin } from "./private-mcp-auth.mjs";

const cleanup = [];
const fixture = await createPrivateMcpNativeFixture({ after: action => cleanup.push(action) });
const root = resolve(import.meta.dirname, "../../../site/dist");
const session = await fixture.forward("session", origin, { method: "GET" });
const sessionCookie = session.body.cookie;
const audit = [];
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json",
};
const server = createServer(async (request, response) => {
  try {
    const local = new URL(request.url, "http://127.0.0.1");
    if (local.pathname === "/__qa/client-access" && request.method === "POST") {
      const issued = await fixture.pat(false);
      const catalog = await fixture.api("", "GET");
      const skill = catalog.body.skills[0];
      const stored = skill === undefined ? null : await fixture.api("/resources/read", "POST", {
        uri: `skillar://private/${skill.skillId}/${skill.head.digest}/SKILL.md`,
      });
      const marker = stored?.status === 200 ?
        /^PROOF_MARKER:\s*(\S+)/m.exec(Buffer.from(stored.body.body, "base64").toString("utf8"))?.[1] : null;
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ token: issued.token, connectionId: issued.connection.connectionId,
        skills: catalog.body.skills, marker }));
      return;
    }
    if (local.pathname.startsWith("/__qa/client-access/") && request.method === "DELETE") {
      const id = local.pathname.slice("/__qa/client-access/".length);
      const revoked = await fixture.manage("DELETE", undefined, undefined, `/api/mcp/connections/${id}`);
      response.writeHead(revoked.status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(revoked.body)); return;
    }
    if (local.pathname === "/__qa/audit") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(audit)); return;
    }
    if (local.pathname === "/__qa/sign-in") {
      response.writeHead(303, { "set-cookie": `${sessionCookie}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        location: "/connections/", "cache-control": "no-store" }); response.end(); return;
    }
    if (local.pathname === "/__qa/sign-out") {
      response.writeHead(303, { "set-cookie": "__Host-skillar_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        location: "/connections/", "cache-control": "no-store" }); response.end(); return;
    }
    if (/^\/(?:api|auth|oauth)\//.test(local.pathname) ||
        local.pathname === "/mcp" || local.pathname.startsWith("/.well-known/")) {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) throw new Error("qa_body_too_large");
        chunks.push(chunk);
      }
      if (local.pathname === "/mcp" && chunks.length) {
        const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        audit.push({ method: message.method, tool: message.params?.name ?? null,
          uri: message.params?.uri ?? null });
      }
      const headers = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined && !["host", "connection", "content-length"].includes(key)) {
          headers[key] = Array.isArray(value) ? value.join(", ") : value;
        }
      }
      if (headers.origin === `http://${request.headers.host}`) headers.origin = origin;
      const upstream = await fixture.rawForward("web", `${origin}${local.pathname}${local.search}`, {
        method: request.method, headers,
        ...(chunks.length ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
      });
      const released = {};
      for (const [key, value] of upstream.headers) if (key !== "set-cookie") released[key] = value;
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) released["set-cookie"] = cookies;
      response.writeHead(upstream.status, released);
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(response); else response.end();
      return;
    }
    let file = resolve(root, `.${decodeURIComponent(local.pathname)}`);
    if (!file.startsWith(`${root}/`) && file !== root) { response.writeHead(404); response.end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const bytes = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store" });
    response.end(bytes);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 503, { "content-type": "text/plain" });
    response.end("Disposable QA host unavailable");
    if (error?.code !== "ENOENT") console.error("QA_HOST_ERROR", error.name);
  }
});
const listening = once(server, "listening");
server.listen(0, "127.0.0.1");
await listening;
console.log(`QA_READY http://127.0.0.1:${server.address().port}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
  process.exit(0);
});
