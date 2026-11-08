-- Explicit labels make a captured query useful without treating an unlabeled observation as a negative judgement.
ALTER TABLE eval_cases ADD COLUMN label TEXT NOT NULL DEFAULT 'unlabeled'
  CHECK (label IN ('unlabeled', 'skill', 'no_match'));
UPDATE eval_cases SET label = CASE WHEN expected_uri IS NULL THEN 'unlabeled' ELSE 'skill' END;
CREATE INDEX eval_cases_label_created ON eval_cases(label, created_at);

-- Runs retain the exact aggregate and per-label outcomes that were observed against a catalog fingerprint.
CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  catalog_fingerprint TEXT NOT NULL,
  catalog_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  baseline INTEGER NOT NULL DEFAULT 0 CHECK (baseline IN (0, 1)),
  metrics_json TEXT NOT NULL
);
CREATE INDEX eval_runs_created ON eval_runs(created_at);
CREATE INDEX eval_runs_baseline ON eval_runs(baseline, created_at) WHERE baseline = 1;

CREATE TABLE eval_run_cases (
  run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  eval_case_id TEXT NOT NULL REFERENCES eval_cases(id),
  label TEXT NOT NULL CHECK (label IN ('skill', 'no_match')),
  expected_uri TEXT,
  language TEXT NOT NULL CHECK (language IN ('ko', 'en', 'other')),
  rank INTEGER,
  abstained INTEGER NOT NULL CHECK (abstained IN (0, 1)),
  PRIMARY KEY (run_id, eval_case_id)
) WITHOUT ROWID;
CREATE INDEX eval_run_cases_case ON eval_run_cases(eval_case_id, run_id);
