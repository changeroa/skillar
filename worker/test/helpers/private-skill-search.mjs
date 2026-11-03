// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const localSearch = await build({
  entryPoints: [fileURLToPath(new URL("../../../local/src/search/index.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", target: "node24",
});
const { createSearchIndex } = await import(
  `data:text/javascript;base64,${Buffer.from(localSearch.outputFiles[0].text).toString("base64")}`
);

export const entry = (id, extra = {}) => ({
  uri: `skill://remote/${id}`, name: id, description: "", examples: [], aliasesKo: [],
  invocation: "automatic", bodyHead: "", digest: `sha256-${id}`, ...extra,
});
export const result = ({ candidates, abstained }) => ({ candidates, ...(abstained ? { abstained } : {}) });
export const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const source = `
import { createPrivateSkillSearch } from "./src/private-skills/search-index.ts";
import { FTS_SEARCH, ftsTokens, ftsMatchExpression } from "../shared/private-search.ts";
export class TestSearch {
  constructor(ctx) { this.ctx=ctx; this.index=createPrivateSkillSearch(ctx.storage); this.boot=crypto.randomUUID(); }
  async fetch(request) {
    const action=await request.json();
    if(action.kind==="rebuild") {
      this.index.rebuild(action.entries,action.threshold);
      return Response.json({ok:true});
    }
    if(action.kind==="search") return Response.json(action.queries.map(({query,opts})=>this.index.search(query,opts)));
    if(action.kind==="fts") {
      const tokens=ftsTokens(action.query);
      return Response.json(tokens.length ? this.ctx.storage.sql.exec(FTS_SEARCH,ftsMatchExpression(tokens),50).toArray() : []);
    }
    if(action.kind==="reconstruct") this.index=createPrivateSkillSearch(this.ctx.storage);
    return Response.json({boot:this.boot});
  }
}
export default { fetch(request,env) {
  const id=env.SEARCH.idFromName(new URL(request.url).pathname.slice(1));
  return env.SEARCH.get(id).fetch(request);
} };
`;
const bundle = build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    sourcefile: "private-skill-search-fixture.mjs" },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
});

export async function fixture(t) {
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    type: "worker", name: "private-search-fixture", compatibilityDate: "2026-09-03",
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: (await bundle).outputFiles[0].text },
    } },
    env: { SEARCH: { type: "durable-object", worker: "private-search-fixture", exportName: "TestSearch" } },
    exports: { TestSearch: { type: "durable-object", storage: "sqlite" } },
  } }] });
  t.after(() => runtime.dispose());
  const send = async (account, action) => {
    const response = await runtime.dispatchFetch(`https://search.test/${account}`, {
      method: "POST", body: JSON.stringify(action),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  return {
    send,
    rebuild: (entries, threshold, account = "account-a") => send(account, { kind: "rebuild", entries, threshold }),
    search: (queries, account = "account-a") => send(account, { kind: "search", queries }),
    evict: (account = "account-a") => runtime.unsafeEvictDurableObject("private-search-fixture", "TestSearch", { name: account }),
  };
}

export async function local(t, entries) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(await readFile(new URL("../../../local/src/store/schema.sql", import.meta.url), "utf8"));
  const index = createSearchIndex(db);
  index.rebuild(entries);
  return {
    index, db,
    search: queries => queries.map(({ query, opts }) => result(index.search(query, opts))),
    threshold: value => db.prepare("INSERT OR REPLACE INTO meta VALUES ('search_threshold', ?)").run(String(value)),
  };
}

export const queries = (texts, modes = ["discovery", "automatic", "explicit"]) =>
  texts.flatMap(query => modes.flatMap(mode => [1, 5, 50].map(limit => ({ query, opts: { mode, limit } }))));
