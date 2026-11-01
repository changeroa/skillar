import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PACKAGE_ROOT, distImport, makeTempDir, removeDir } from "./_helpers.mjs";

const { openDb } = await distImport("store/db.js");

test("migration 007 distinguishes old unlabeled cases from old skill expectations", () => {
  const dir = makeTempDir();
  try {
    const path = join(dir, "v6.db");
    const old = new DatabaseSync(path);
    for (const file of ["schema.sql", "migrations/002_tracing.sql", "migrations/003_tracing_indexes.sql", "migrations/004_load_reconciliation.sql",
      "migrations/005_execution_boundaries.sql", "migrations/006_recording_order.sql"]) {
      old.exec(readFileSync(new URL(`dist/store/${file}`, PACKAGE_ROOT), "utf8"));
    }
    old.exec(`PRAGMA user_version = 6;
      INSERT INTO eval_cases (id, query, expected_uri, created_at) VALUES
        ('old-unlabeled', 'captured query', NULL, 1),
        ('old-skill', 'known query', 'skill://local/a/SKILL.md', 2);`);
    old.close();

    const db = openDb(path);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 7);
      assert.deepEqual(db.prepare("SELECT id, label FROM eval_cases ORDER BY created_at").all().map((row) => [row.id, row.label]), [
        ["old-unlabeled", "unlabeled"], ["old-skill", "skill"],
      ]);
    } finally {
      db.close();
    }
  } finally {
    removeDir(dir);
  }
});
