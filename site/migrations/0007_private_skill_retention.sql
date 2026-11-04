-- Retention starts at retirement, never at the original publication time.
ALTER TABLE private_skill_versions ADD COLUMN retired_at INTEGER;
ALTER TABLE private_skill_uploads ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
UPDATE private_skill_uploads SET created_at=unixepoch()*1000;
UPDATE private_skill_versions SET retired_at=unixepoch()*1000
WHERE pinned=0 AND EXISTS(
  SELECT 1 FROM private_skills s WHERE s.account_id=private_skill_versions.account_id
  AND s.generation=private_skill_versions.generation AND s.skill_id=private_skill_versions.skill_id
  AND s.digest!=private_skill_versions.digest);

-- Permanent, path-free identities. No FK: account/metadata deletion must not
-- destroy the ability to delete a PUT that completes after an earlier purge.
CREATE TABLE private_skill_purges (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  skill_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  resource_digests_json TEXT NOT NULL,
  resource_offset INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER,
  sweep_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation,skill_id,digest)
);
CREATE INDEX private_skill_purge_order ON private_skill_purges(sweep_order);
CREATE INDEX private_skill_retirement ON private_skill_versions(retired_at);
CREATE INDEX private_skill_upload_age ON private_skill_uploads(created_at);

CREATE TRIGGER private_skill_upload_clock AFTER INSERT ON private_skill_uploads
WHEN NEW.created_at=0 BEGIN
  UPDATE private_skill_uploads SET created_at=unixepoch()*1000
  WHERE account_id=NEW.account_id AND generation=NEW.generation
  AND skill_id=NEW.skill_id AND digest=NEW.digest;
END;
CREATE TRIGGER private_skill_retire_head AFTER UPDATE OF digest ON private_skills
WHEN NEW.digest!=OLD.digest BEGIN
  UPDATE private_skill_versions SET retired_at=CASE
    WHEN digest=NEW.digest OR pinned=1 THEN NULL ELSE NEW.updated_at END
  WHERE account_id=NEW.account_id AND generation=NEW.generation
  AND skill_id=NEW.skill_id AND digest IN (OLD.digest,NEW.digest);
END;
CREATE TRIGGER private_skill_retire_pin AFTER UPDATE OF pinned ON private_skill_versions
WHEN NEW.pinned!=OLD.pinned BEGIN
  UPDATE private_skill_versions SET retired_at=CASE
    WHEN NEW.pinned=1 OR EXISTS(SELECT 1 FROM private_skills s
      WHERE s.account_id=NEW.account_id AND s.generation=NEW.generation
      AND s.skill_id=NEW.skill_id AND s.digest=NEW.digest) THEN NULL
    ELSE (SELECT updated_at FROM private_skills s WHERE s.account_id=NEW.account_id
      AND s.generation=NEW.generation AND s.skill_id=NEW.skill_id) END
  WHERE account_id=NEW.account_id AND generation=NEW.generation
  AND skill_id=NEW.skill_id AND digest=NEW.digest;
END;

-- Explicit deletion records identities in the same transaction as its fence,
-- before any R2 deletion or metadata removal can happen.
CREATE TRIGGER private_skill_version_purge AFTER UPDATE OF deleting_revision ON private_skill_versions
WHEN NEW.deleting_revision IS NOT NULL BEGIN
  INSERT INTO private_skill_purges(account_id,generation,skill_id,digest,resource_digests_json)
  VALUES(NEW.account_id,NEW.generation,NEW.skill_id,NEW.digest,
    (SELECT json_group_array(json_extract(value,'$.digest'))
      FROM json_each(NEW.manifest_json,'$.resources')))
  ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER private_skill_tombstone_purge AFTER UPDATE OF tombstoned ON private_skills
WHEN NEW.tombstoned=1 BEGIN
  INSERT INTO private_skill_purges(account_id,generation,skill_id,digest,resource_digests_json)
  SELECT account_id,generation,skill_id,digest,
    (SELECT json_group_array(json_extract(value,'$.digest'))
      FROM json_each(manifest_json,'$.resources'))
  FROM private_skill_uploads WHERE account_id=NEW.account_id
    AND generation=NEW.generation AND skill_id=NEW.skill_id
  UNION
  SELECT account_id,generation,skill_id,digest,
    (SELECT json_group_array(json_extract(value,'$.digest'))
      FROM json_each(manifest_json,'$.resources'))
  FROM private_skill_versions WHERE account_id=NEW.account_id
    AND generation=NEW.generation AND skill_id=NEW.skill_id
  ON CONFLICT DO NOTHING;
END;

-- A purge claim is irreversible. All writers, including PUT retries and a
-- writer paused between byte verification and final head CAS, obey it.
CREATE TRIGGER private_skill_upload_purge_fence BEFORE INSERT ON private_skill_uploads
WHEN EXISTS(SELECT 1 FROM private_skill_purges p WHERE p.account_id=NEW.account_id
  AND p.generation=NEW.generation AND p.skill_id=NEW.skill_id AND p.digest=NEW.digest) BEGIN
  SELECT RAISE(ABORT,'private_skill_purge_claimed');
END;
CREATE TRIGGER private_skill_head_insert_purge_fence BEFORE INSERT ON private_skills
WHEN EXISTS(SELECT 1 FROM private_skill_purges p WHERE p.account_id=NEW.account_id
  AND p.generation=NEW.generation AND p.skill_id=NEW.skill_id AND p.digest=NEW.digest) BEGIN
  SELECT RAISE(ABORT,'private_skill_purge_claimed');
END;
CREATE TRIGGER private_skill_head_purge_fence BEFORE UPDATE OF digest ON private_skills
WHEN EXISTS(SELECT 1 FROM private_skill_purges p WHERE p.account_id=NEW.account_id
  AND p.generation=NEW.generation AND p.skill_id=NEW.skill_id AND p.digest=NEW.digest) BEGIN
  SELECT RAISE(ABORT,'private_skill_purge_claimed');
END;
CREATE TRIGGER private_skill_pin_purge_fence BEFORE UPDATE OF pinned ON private_skill_versions
WHEN NEW.pinned=1 AND EXISTS(SELECT 1 FROM private_skill_purges p WHERE p.account_id=NEW.account_id
  AND p.generation=NEW.generation AND p.skill_id=NEW.skill_id AND p.digest=NEW.digest) BEGIN
  SELECT RAISE(ABORT,'private_skill_purge_claimed');
END;
