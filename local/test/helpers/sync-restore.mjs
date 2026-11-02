import { createHash } from "node:crypto";
import { join } from "node:path";
import { distImport, makeTempDir, removeDir } from "../_helpers.mjs";
import { logicalSnapshot, openDb, seedAll } from "./sync.mjs";

export const { restoreSnapshot, applyCatchup, verify } = await distImport("sync/restore.js");
export const { targetTables } = await distImport("sync/tables.js");

export function descriptor(pages) {
  const records = pages.flatMap(page => page.records);
  return {
    sourceDomain: pages[0].sourceDomain, cut: pages[0].cut,
    counts: Object.fromEntries(targetTables.map(table =>
      [table, records.filter(row => row.table === table).length])),
    hash: createHash("sha256").update(JSON.stringify(records)).digest("hex"),
  };
}

export function pagesFor(records, sourceDomain, cut) {
  const payload = JSON.stringify(records);
  return [{ snapshotId: "fixture", sourceDomain, cut, index: 0, records,
    bytes: Buffer.byteLength(payload),
    hash: createHash("sha256").update(payload).digest("hex") }];
}

export const triggers = db => db.prepare(
  "SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
export const facts = db => [...logicalSnapshot(db)].flatMap(page => page.records)
  .map(({ revision, ...row }) => row);
export const clock = db => ({ ...db.prepare("SELECT * FROM recording_clock").get() });

export function seedRich(source) {
  seedAll(source);
  // Every SQL column is exercised, including nested raw data and mixed domain vectors.
  const nested = JSON.stringify({ args: { lines: ["x".repeat(90_000)], nested: [{ zero: 0, nil: null }] },
    attributionCandidates: ["s", "foreign"], query: "query\nwith unicode 한글" });
  source.prepare(`UPDATE events SET rowid=0,source_key='source:key',turn_key='turn',call_id='call',
    span_id='span',text_digest='digest',text_length=7,trace_id='trace',load_id='l',
    skill_uri='skill://private/SKILL.md',tool_use_id='tool',data_json=?,
    recording_orders_json=?`).run(nested, '{"original":0,"other":17}');
  source.exec(`UPDATE skills SET rowid=0,description='description',tags_json='["a"]',
      when_to_use='when',examples_json='["example"]',aliases_ko_json='["alias"]',
      group_id='group',group_stage='stage',invocation='explicit',body_head='raw body',
      resources_json='[{"path":"SKILL.md","bytes":42}]',mtime_ms=9,removed_at=NULL;
    UPDATE sessions SET rowid=0,runtime_session_id='runtime-id',conversation_id='conversation',
      client_name='client',cwd='/original',end_orders_json='{"original":0,"other":19}';
    UPDATE loads SET rowid=0,trace_id='trace',resources_json='[{"path":"nested/file"}]';
    UPDATE eval_cases SET rowid=0,expected_uri='skill://private/SKILL.md',from_trace_id='trace';
    UPDATE otel_spans SET rowid=0,parent_span_id='parent',conversation_id='conversation',
      turn_key='turn',call_id='call';
    UPDATE otel_spans SET recording_orders_json='{"original":0,"other":23}';
    UPDATE herdr_workspaces SET rowid=0,closed_ms=300;
    UPDATE herdr_tabs SET rowid=0,closed_ms=300;
    UPDATE herdr_panes SET rowid=0,label='pane',closed_ms=300,agent='codex',last_seen_ms=299;
    UPDATE pane_sessions SET rowid=0,agent='codex',source='reported',last_seen_ms=300;
    UPDATE workflow_specs SET rowid=0,body_json='{"steps":[{"id":"step","nested":{"args":[0,null]}}]}';
    UPDATE flows SET rowid=0,workspace_id='w',tab_id='t',label='flow',ended_ms=250,
      start_order_domain='original',start_order=0,end_order_domain='other',end_order=29,
      start_event_ids_json='["e"]',end_event_ids_json='["e"]',
      end_sessions_json='[{"id":"s","endedAt":200}]',
      end_spans_json='[{"traceId":"trace","spanId":"span"}]';
    UPDATE flow_steps SET rowid=0;
    INSERT INTO flows(id,workspace_id,registered_ms,ended_ms) VALUES ('unknown','w',0,250);
    INSERT INTO loads(load_id,uri,manifest_digest,created_at) VALUES ('delete-me','uri','digest',0);`);
}

export function fixture(t) {
  const dir = makeTempDir("skillar-restore-");
  const sourcePath = join(dir, "source.db");
  const destinationPath = join(dir, "destination.db");
  const source = openDb(sourcePath);
  const destination = openDb(destinationPath);
  t.after(() => { source.close(); destination.close(); removeDir(dir); });
  seedRich(source);
  const pages = [...logicalSnapshot(source, { maxRecords: 2 })];
  return { dir, sourcePath, destinationPath, source, destination, pages, descriptor: descriptor(pages) };
}

export function restoredFacts(db) {
  const saved = db.prepare("SELECT clock_json FROM sync_restore_state").get();
  return facts(db).map(row => row.table === "recording_clock"
    ? (({ revision, ...record }) => record)(JSON.parse(saved.clock_json)) : row);
}
