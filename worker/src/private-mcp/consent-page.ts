// SPDX-License-Identifier: AGPL-3.0-only
import type { ConsentDescription } from "@cloudflare/workers-oauth-provider-v1";
import { mcpNoStore } from "./contracts.ts";

const escape = (text: string): string => text.replace(/[&<>"']/g, character => {
  switch (character) {
    case "&": return "&amp;";
    case "<": return "&lt;";
    case ">": return "&gt;";
    case '"': return "&quot;";
    case "'": return "&#39;";
    default: return character;
  }
});

export function consentPage(
  details: ConsentDescription, handle: string, headers: Headers,
): Response {
  const domain = details.clientDomain === undefined ?
    "<p class=\"note\">This client name is self-reported, not verified by skillar.</p>" :
    `<p class="note">Verified client domain: <strong>${escape(details.clientDomain)}</strong></p>`;
  const loopback = details.redirectIsLoopback ?
    "<p class=\"note\">This returns to a local application. Any local process could be listening; continue only if you just started this connection.</p>" : "";
  for (const [name, value] of Object.entries(mcpNoStore)) headers.set(name, value);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", [
    "default-src 'none'; style-src 'self'; img-src 'self';",
    `form-action 'self' ${new URL(details.redirectUri).origin}; base-uri 'none'; frame-ancestors 'none'`,
  ].join(" "));
  return new Response(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="description" content="Review a private skillar MCP connection.">
<title>Allow an MCP connection - skillar</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/mcp-consent.css">
</head><body><a class="skip" href="#main">Skip to content</a>
<header><a class="wordmark" href="/login/" aria-label="skillar account">
<img class="wordmark-light" src="/wordmark-light.svg" width="120" height="24" alt="">
<img class="wordmark-dark" src="/wordmark-dark.svg" width="120" height="24" alt=""></a>
<a href="/connections/">Your connections</a></header>
<main id="main"><p class="eyebrow">PRIVATE MCP CONNECTION</p>
<h1>Let this client<br>read your skills?</h1>
<section aria-labelledby="client"><h2 id="client">${escape(details.clientName)}</h2>${domain}
<dl><div><dt>Returns to</dt><dd><code>${escape(new URL(details.redirectUri).host)}</code></dd></div>
<div><dt>Can do</dt><dd>List, search and read the private skills you publish.</dd></div>
<div><dt>Cannot do</dt><dd>Upload local files, edit skills or manage your account.</dd></div></dl>
${loopback}</section>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="handle" value="${escape(handle)}">
<label class="choice"><input type="checkbox" name="recordActivity" value="yes">
<span><strong>Also record this connection's activity.</strong>
<small>Save its search queries and resource-read observations in my activity dashboard.
This history is server-readable, retained for 30 days by default, and separate from local device uploads.</small></span></label>
<p class="note">You are authorizing the account currently signed into skillar.
You can revoke this connection later; revocation does not delete existing history.</p>
<div class="actions"><button class="primary" type="submit" name="decision" value="approve">Allow private read access</button>
<button class="secondary" type="submit" name="decision" value="deny">Cancel connection</button></div>
</form></main><footer><a href="/skills/">Your private skills</a><a href="/login/">Account</a></footer>
</body></html>`, { headers });
}
