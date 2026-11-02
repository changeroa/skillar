-- Synthetic local Pages QA only; never execute against remote ACCOUNTS.
INSERT INTO users VALUES (
  'activity-qa', 'activity-qa@example.test', '', '',
  CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)
);
INSERT INTO sessions VALUES (
  'activity-qa-session-ssssssssssssssssssssssssssssssss',
  'activity-qa', CAST(strftime('%s','now') AS INTEGER) + 3600
);
