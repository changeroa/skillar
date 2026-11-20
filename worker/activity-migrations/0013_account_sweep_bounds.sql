-- AGPL-3.0-only. Bounded sweeps read index ranges instead of full tables.
-- Every purge re-sequencing statement shares the MAX(purge_order) scan; one index
-- per swept table turns it into a single index-end read, and each retention
-- sweep's ORDER BY purge_order,object_key LIMIT walks the same prefix.
CREATE INDEX content_uploads_purge_order ON content_uploads(purge_order,object_key);
CREATE INDEX report_objects_purge_order ON report_objects(purge_order,object_key);
CREATE INDEX deletion_objects_purge_order ON deletion_objects(purge_order,object_key);
CREATE INDEX connector_commands_purge_order ON connector_commands(purge_order,object_key);
CREATE INDEX private_pack_jobs_purge_order ON private_pack_jobs(purge_order,object_key);
CREATE INDEX dashboard_eval_cases_purge_order ON dashboard_eval_cases(purge_order,object_key);
