-- Judgements stay local: eval_cases is part of the portable/sync projection and remains five columns.
CREATE TABLE eval_case_labels (
  eval_case_id TEXT PRIMARY KEY REFERENCES eval_cases(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (label IN ('unlabeled', 'skill', 'no_match'))
) WITHOUT ROWID;
INSERT INTO eval_case_labels (eval_case_id, label)
  SELECT id, CASE WHEN expected_uri IS NULL THEN 'unlabeled' ELSE 'skill' END FROM eval_cases;
CREATE INDEX eval_case_labels_label ON eval_case_labels(label);

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
