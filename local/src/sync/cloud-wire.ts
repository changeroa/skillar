// This entrypoint is bundled by build-cloud.mjs. The published local package
// never depends on a sibling shared/ checkout at runtime.
export {
  authorizeUpload, consentSchema,
} from "../../../shared/dist/activity-consent.js";
export type {
  Consent, UploadScope,
} from "../../../shared/dist/activity-consent.js";
export {
  contentKinds, ActivityContractError,
} from "../../../shared/dist/activity-schema.js";
export {
  contentDocumentSchema, contentChunkRefSchema, parseContentBatch,
  parseContentChunkUpload, transformContentRows, MAX_CONTENT_CHUNK_BYTES,
  MAX_CONTENT_BYTES, ContentContractError,
} from "../../../shared/dist/activity-content.js";
export type {
  ContentBatch, ContentChunkUpload, ContentDocument, ContentRow,
} from "../../../shared/dist/activity-content.js";
export {
  migrationBeginSchema, migrationPageSchema, migrationReferenceSchema,
  migrationStatusSchema, summarizeSnapshot, snapshotPageDocumentSchema,
  MAX_SNAPSHOT_PAGES, MAX_SNAPSHOT_ROWS, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_PAGE_BYTES,
} from "../../../shared/dist/activity-sync.js";
export type {
  MigrationBegin, MigrationPage, MigrationStatus, SnapshotCounts,
} from "../../../shared/dist/activity-sync.js";
