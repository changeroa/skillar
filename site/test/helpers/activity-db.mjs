import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

// Execute every batch synchronously within one SQLite transaction, just as D1
// serializes a batch. Awaiting individual queries would permit nested batches.
export async function activityDb(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  for (const migration of ['0001_accounts.sql', '0002_activity_accounts.sql', '0003_activity_consent.sql',
    '0004_account_events.sql']) {
    db.exec(await readFile(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const execute = (sql, args) => {
    const query = db.prepare(sql);
    const before = db.prepare('SELECT total_changes() AS changes').get().changes;
    const results = query.columns().length ? query.all(...args) : [];
    const info = query.columns().length ? null : query.run(...args);
    const changes = info?.changes ??
      db.prepare('SELECT total_changes() AS changes').get().changes - before;
    return {
      success: true, results,
      meta: {
        changes: Number(changes), last_row_id: Number(info?.lastInsertRowid ?? 0),
        duration: 0, changed_db: changes > 0, rows_read: results.length, rows_written: Number(changes),
      },
    };
  };
  const executions = new WeakMap();
  const statement = (sql, args = []) => {
    const query = {
      bind: (...values) => statement(sql, values),
      first: async column => {
        const row = db.prepare(sql).get(...args);
        return row === undefined ? null : column === undefined ? row : row[column] ?? null;
      },
      run: async () => execute(sql, args),
      all: async () => execute(sql, args),
    };
    executions.set(query, () => execute(sql, args));
    return query;
  };
  const accounts = {
    prepare: statement,
    batch: async queries => {
      db.exec('BEGIN');
      try {
        const results = queries.map(query => {
          const executeQuery = executions.get(query);
          if (!executeQuery) throw new TypeError('Batch statement belongs to another database');
          return executeQuery();
        });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, accounts };
}
