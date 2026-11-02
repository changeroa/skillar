export interface ContentEnv {
  readonly ACTIVITY: D1Database;
  readonly ACCOUNTS: D1Database;
  readonly ACTIVITY_RAW: R2Bucket;
  readonly CONTENT_KEYRING: string;
  readonly ACTIVITY_INGEST_ENABLED?: string;
}
