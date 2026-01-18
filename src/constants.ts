/**
 * Default configuration constants
 */

/** Default reconnect interval in milliseconds */
export const DEFAULT_RECONNECT_INTERVAL = 1000;

/** Default maximum reconnect interval in milliseconds */
export const DEFAULT_MAX_RECONNECT_INTERVAL = 30000;

/** Default buffer size for receive and send queues */
export const DEFAULT_BUFFER_SIZE = 100;

/** Maximum number of recent events to keep when no iterators are active */
export const MAX_RECENT_EVENTS = 10;

/** Jitter percentage for reconnect backoff (±20%) */
export const RECONNECT_JITTER_RATIO = 0.2;

/** Polling interval in milliseconds for waitForItems fallback */
export const POLLING_INTERVAL_MS = 100;
