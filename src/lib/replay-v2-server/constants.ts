export const MAX_INIT_JSON_BYTES = 64 * 1024;
export const MAX_COMPLETE_JSON_BYTES = 1 * 1024;
export const MAX_VISIBILITY_JSON_BYTES = 8 * 1024;
export const MAX_RAW_GZIP_BYTES = 4 * 1024 * 1024;
export const MAX_RAW_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_CANONICAL_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_CANONICAL_GZIP_BYTES = 4 * 1024 * 1024;
export const FIRESTORE_CHUNK_CHAR_SIZE = 450_000;
export const MAX_FIRESTORE_ARTIFACT_CHUNKS = 24;
export const DEFAULT_REPLAY_LIST_LIMIT = 48;
export const MAX_REPLAY_LIST_LIMIT = 100;
export const FIRESTORE_ARTIFACT_FALLBACK_ENV = "REPLAY_V2_ALLOW_FIRESTORE_ARTIFACTS";

// The desktop uploader retries 425 responses. Keep in-flight completion races
// on that retryable lane so one successful worker cannot leave another caller
// with a permanent local failure.
export const REPLAY_PROCESSING_RETRY_STATUS = 425;
export const REPLAY_PROCESSING_RETRY_AFTER_SECONDS = 5;

// Stable product/API code used by desktop and website recovery controls. Keep
// this independent from the human-readable quality message.
export const REPLAY_CAPTURE_MISSING_MULLIGAN_CODE = "replay_capture_missing_mulligan";

export const REPLAY_COLLECTION = "replayV2";
export const REPLAY_OWNER_COLLECTION = "replayV2Owners";
export const REPLAY_PUBLIC_COLLECTION = "replayV2Public";
export const REPLAY_ARTIFACT_COLLECTION = "replayV2Artifacts";
