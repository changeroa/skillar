-- Primary metadata and credential fences share the same transaction.
ALTER TABLE account_control_outbox ADD COLUMN invalidation_kind TEXT NOT NULL
  DEFAULT 'consent' CHECK (invalidation_kind IN ('consent','skills'));
CREATE TABLE private_skill_catalogs (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,generation)
);
CREATE TABLE private_skills (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  skill_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  tombstoned INTEGER NOT NULL DEFAULT 0 CHECK(tombstoned IN (0,1)),
  purge_complete INTEGER NOT NULL DEFAULT 0 CHECK(purge_complete IN (0,1)),
  mutation_id TEXT NOT NULL,
  PRIMARY KEY(account_id,generation,skill_id)
);
CREATE TABLE private_skill_versions (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  skill_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  deleting_revision INTEGER,
  PRIMARY KEY(account_id,generation,skill_id,digest),
  FOREIGN KEY(account_id,generation,skill_id)
    REFERENCES private_skills(account_id,generation,skill_id)
);
-- Record bounded manifests before PUT, retaining failed/late upload identities.
CREATE TABLE private_skill_uploads (
  account_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  skill_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  PRIMARY KEY(account_id,generation,skill_id,digest)
);
CREATE TRIGGER private_skill_created AFTER INSERT ON private_skills BEGIN
  INSERT INTO private_skill_catalogs(account_id,generation,revision)
    VALUES(NEW.account_id,NEW.generation,1)
    ON CONFLICT(account_id,generation) DO UPDATE SET revision=revision+1;
  INSERT INTO account_control_outbox(account_id,generation,invalidation_kind)
    VALUES(NEW.account_id,NEW.generation,'skills');
END;
CREATE TRIGGER private_skill_changed AFTER UPDATE OF revision ON private_skills
WHEN NEW.revision!=OLD.revision BEGIN
  UPDATE private_skill_catalogs SET revision=revision+1
    WHERE account_id=NEW.account_id AND generation=NEW.generation;
  INSERT INTO account_control_outbox(account_id,generation,invalidation_kind)
    VALUES(NEW.account_id,NEW.generation,'skills');
END;
