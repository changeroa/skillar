import { z } from "zod";
import type { Db } from "../store/db.js";
import { targetTables } from "./tables.js";

/**
 * Installed inside migration 007's transaction. Read actual stored values rather
 * than NEW: an older AFTER trigger may already have changed the row. Each later
 * derived write appends another image; readJournal chooses the last at the cut.
 * Recursive triggers are enabled on every open, including REPLACE's delete path.
 */
export function installJournalTriggers(db: Db): void {
  for (const table of targetTables) {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map(row =>
      z.object({ name: z.string(), pk: z.number() }).parse(row));
    const keys = columns.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
    const key = (prefix: string) => `json_array(${keys.map(c => `${prefix}."${c.name}"`).join(",")})`;
    const match = keys.map(c => `"${c.name}" IS NEW."${c.name}"`).join(" AND ");
    const changedKey = keys.map(c => `OLD."${c.name}" IS NOT NEW."${c.name}"`).join(" OR ");
    const values = `json_object(${columns.map(c => `'${c.name}',"${c.name}"`).join(",")})`;
    const before = `json_object(${columns.map(c => `'${c.name}',OLD."${c.name}"`).join(",")})`;
    const order = table === "load_candidates" ? "NULL" : "rowid";
    const oldOrder = table === "load_candidates" ? "NULL" : "OLD.rowid";
    const upsert = `INSERT INTO sync_journal(table_name,entity_key,operation,source_order,row_json)
      SELECT '${table}',${key(table)},'upsert',${order},${values} FROM "${table}" WHERE ${match};`;
    const tombstone = `INSERT INTO sync_journal(table_name,entity_key,operation,source_order,row_json,before_json)
      VALUES ('${table}',${key("OLD")},'delete',${oldOrder},NULL,${before});`;
    db.exec(`
      CREATE TRIGGER sync_${table}_insert AFTER INSERT ON "${table}" BEGIN ${upsert} END;
      CREATE TRIGGER sync_${table}_update AFTER UPDATE ON "${table}" BEGIN
        INSERT INTO sync_journal(table_name,entity_key,operation,source_order,row_json,before_json)
          SELECT '${table}',${key("OLD")},'delete',${oldOrder},NULL,${before} WHERE ${changedKey};
        ${upsert}
      END;
      CREATE TRIGGER sync_${table}_delete AFTER DELETE ON "${table}" BEGIN ${tombstone} END;
    `);
  }
}
