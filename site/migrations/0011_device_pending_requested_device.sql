-- Additive only: rollback is ALTER TABLE device_pending_codes DROP COLUMN requested_device_id.
-- Set at creation when the CLI asks to add scopes to a device it already owns;
-- approval then reuses that device row instead of minting a new one.
ALTER TABLE device_pending_codes ADD COLUMN requested_device_id TEXT;
