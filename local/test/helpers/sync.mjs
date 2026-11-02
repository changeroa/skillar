import { distImport } from "../_helpers.mjs";

export const { openDb } = await distImport("store/db.js");
export const { journalHead, readJournal } = await distImport("sync/journal.js");
export const { logicalSnapshot } = await distImport("sync/snapshot.js");
export const { spoolBatch, pendingBatch, acknowledgeBatch } = await distImport("sync/outbox.js");
export const { contentKinds } = await distImport("sync/consent.js");
export const scope = {
  deviceId: "device", projectId: "project", rootId: null, consentVersion: 1,
  fromMs: 0, toMs: 10000, contentKinds: [], backfill: null,
};
export const consent = {
  mode: "metadata", version: 1, grantedAtMs: 0,
  scope: { deviceId: "device", projectIds: ["project"], rootIds: [] },
};
export function request(db, extra = {}) {
  const { cut } = journalHead(db);
  return {
    streamId: "stream", consent, scope,
    journal: { from: 0, through: cut },
    records: readJournal(db, { after: 0, through: cut }),
    scopeFor: () => ({ projectId: "project", rootId: null }),
    ...extra,
  };
}
export function addSession(db, id = "s", prompt = "SENTINEL") {
  db.prepare("INSERT INTO sessions(id,runtime,started_at,first_prompt) VALUES (?,'codex',100,?)")
    .run(id, prompt);
}
export function seedAll(db) {
  db.exec(`INSERT INTO skills(uri,root_id,name,digest,manifest_digest)
      VALUES ('skill://private/SKILL.md','root','SENTINEL','digest','manifest');
    INSERT INTO sessions(id,runtime,started_at,ended_at,first_prompt) VALUES ('s','codex',100,200,'SENTINEL');
    INSERT INTO events(id,ts,kind,source,session_id,attribution_method,attribution_reason,runtime,data_json,text)
      VALUES ('e',150,'load','mcp','unattributed','none','ambiguous','codex',
      '{"attributionCandidates":["s"],"query":"SENTINEL"}','SENTINEL');
    INSERT INTO loads(load_id,uri,manifest_digest,created_at) VALUES ('l','skill://private/SKILL.md','digest',150);
    INSERT INTO eval_cases(id,query,created_at) VALUES ('eval','SENTINEL',150);
    INSERT INTO otel_spans(trace_id,span_id,name,runtime,start_ms,end_ms,received_at)
      VALUES ('trace','span','SENTINEL','codex',110,190,200);
    INSERT INTO herdr_workspaces(id,label,created_ms) VALUES ('w','SENTINEL',100);
    INSERT INTO herdr_tabs(id,workspace_id,label,created_ms) VALUES ('t','w','SENTINEL',100);
    INSERT INTO herdr_panes(id,workspace_id,tab_id,cwd,created_ms) VALUES ('p','w','t','/SENTINEL',100);
    INSERT INTO pane_sessions(pane_id,agent_session_value,session_id,first_seen_ms) VALUES ('p','agent','s',100);
    INSERT INTO workflow_specs(id,name,version,body_json,digest,created_ms) VALUES ('spec','SENTINEL',1,'{"steps":[]}','digest',100);
    INSERT INTO flows(id,spec_id,registered_ms,start_order_domain,start_order,end_order_domain,end_order)
      SELECT 'flow','spec',100,domain,0,domain,position FROM recording_clock;
    INSERT INTO flow_steps(flow_id,pane_id,step_id,registered_ms) VALUES ('flow','p','step',100);`);
}
