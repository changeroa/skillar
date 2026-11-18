# Local MCP smoke result

## Isolated data source

A temporary directory supplied two synthetic packages to the local built server under source ID `fixture`. The wrapper invoked `server/dist/codex.js` over stdio, with the upstream server launched as:

```sh
env SKILLAR_ROOT="$fixture" SKILLAR_SKILL_ROOTS="fixture=$fixture" node dist/index.js
```

The temporary `database-query/SKILL.md` and `accessibility-check/SKILL.md` frontmatter contained the same added bilingual keywords as `server/bench/catalog.json`. This was not a request to `changeroa/iyen-skills`, R2, or any deployed endpoint.

## Exact MCP `search_skills` outcomes

```json
{"query":"디비 병목을 찾아줘","mode":"discovery","totalMatches":1,"skills":[{"uri":"skill://skillar/fixture/database-query/SKILL.md","name":"database-query","invocation":"automatic"}]}
{"query":"스크린리더 레이블을 점검해줘","mode":"discovery","totalMatches":1,"skills":[{"uri":"skill://skillar/fixture/accessibility-check/SKILL.md","name":"accessibility-check","invocation":"automatic"}]}
{"query":"디비 병목을 찾아줘","mode":"legacy","totalMatches":0,"skills":[]}
```

The legacy response confirms the unchanged all-literal-word behavior for the natural-language DB query. The discovery responses show only canonical URIs for the temporary source ID, not production catalog identities.

## Cleanup

The smoke command closed the MCP client, recursively removed the temporary skill root and its `SKILLAR_EVENT_LOG_DIR`, then asserted that the temporary path no longer existed. No listening port, external catalog file, or production release was created or changed.
