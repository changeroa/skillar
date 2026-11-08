import test from "node:test";
import { parityStore, assertReadParity } from "./helpers/activity-facts.mjs";

test("SQL BINARY, rowid and aggregate ties retain raw Unicode names and null topology", t => {
  const f = parityStore(t, { now: 1000 });
  f.db.exec(`INSERT INTO flows(id,workspace_id,registered_ms) VALUES ('null-workspace',NULL,0);
    INSERT INTO herdr_workspaces(id) VALUES ('null-workspace');
    INSERT INTO herdr_panes(id,workspace_id,created_ms) VALUES ('unowned',NULL,0)`);
  const ids = ["z", "a", "\uE000", "𐀀"];
  for (const id of ids) {
    f.db.prepare("INSERT INTO sessions(id,runtime,runtime_session_id,started_at,first_prompt) VALUES (?,'codex',?,0,'prompt')").run(id, id);
    f.db.prepare("INSERT INTO herdr_workspaces(id,created_ms) VALUES (?,0)").run(id);
    f.db.prepare("INSERT INTO herdr_panes(id,workspace_id,created_ms) VALUES (?,?,0)").run(id, id);
    f.db.prepare("INSERT INTO pane_sessions(pane_id,agent_session_value,session_id,first_seen_ms) VALUES (?,'same',?,0)").run(id, id);
    f.store.append({ id, ts: 10, kind: "load", source: "mcp", ref: { runtime: "codex" }, skillUri: `skill://${id}/SKILL.md`, data: {} },
      { sessionId: id, method: "runtime_id" });
    f.store.upsertSkills([{ uri: `skill://${id}/SKILL.md`, name: "same", rootId: "r", dir: "", description: "", tags: [], examples: [],
      aliasesKo: [], invocation: "automatic", bodyHead: "", digest: "", manifestDigest: "", resources: [], mtimeMs: 0 }]);
  }
  const facts = f.facts();
  const cases = [["sessions", { runtime: ["codex"] }], ["openSessions", "codex", 0],
    ["listFlows", { from: 0, limit: 100 }], ["skillWeek", {}], ["stats"], ["treeFlowData", "null-workspace"]];
  for (const id of ids) cases.push(["treeFlowData", id], ["treeSessionData", id]);
  for (const filter of [{}, { skill: ids.map(id => `skill://${id}/SKILL.md`) }, { runtime: ["codex"] }]) {
    cases.push(["skillWeek", filter], ["flow", filter, "all_loads"]);
  }
  assertReadParity(f.store, facts, cases);
});
