import type {
  SocketEvent,
  SocketEventType,
  ReconnectBackoff,
  SocketOptions,
  NormalizedSocketOptions,
  ReconnectConfig,
  InternalSocketState,
  BufferOverflowPolicy,
} from './types.js';
import {
  RECONNECT_JITTER_RATIO,
  POLLING_INTERVAL_MS,
  DEFAULT_RECONNECT_INTERVAL,
  DEFAULT_MAX_RECONNECT_INTERVAL,
  DEFAULT_BUFFER_SIZE,
} from './constants.js';

/**
 * Create a socket event object with timestamp
 * 
 * @param type - The type of socket event
 * @param meta - Optional metadata to attach to the event
 * @returns SocketEvent object with type, timestamp, and optional metadata
 */
export function createEvent(
  type: SocketEventType,
  meta?: Record<string, any>
): SocketEvent {
  return {
    type,
    ts: Date.now(),
    meta,
  };
}

/**
 * Calculate reconnect interval with backoff strategy and jitter
 * 
 * @param attempt - Current reconnect attempt number (0-based)
 * @param baseInterval - Base interval in milliseconds
 * @param backoff - Backoff strategy: 'exponential' or 'linear'
 * @param maxInterval - Maximum interval in milliseconds
 * @returns Calculated interval in milliseconds with jitter applied
 */
export function calculateReconnectInterval(
  attempt: number,
  baseInterval: number,
  backoff: ReconnectBackoff,
  maxInterval: number
): number {
  let interval: number;
  if (backoff === 'exponential') {
    interval = baseInterval * Math.pow(2, attempt);
  } else {
    // linear backoff
    interval = baseInterval * (attempt + 1);
  }

  // Add jitter (±20%)
  const jitter = interval * RECONNECT_JITTER_RATIO * (Math.random() * 2 - 1);
  interval = Math.min(interval + jitter, maxInterval);

  return Math.max(0, Math.min(interval, maxInterval));
}

/**
 * Normalize socket options with default values
 * 
 * Converts user-provided options to a normalized format with all required fields
 * filled in with defaults. Handles boolean reconnect option and partial configs.
 * 
 * @param options - User-provided socket options
 * @returns Normalized options with all fields required and defaults applied
 */
export function normalizeOptions(options: SocketOptions): NormalizedSocketOptions {
  // Handle reconnect config: boolean or ReconnectConfig
  const reconnectOption = options.reconnect;
  const reconnectConfig: ReconnectConfig =
    typeof reconnectOption === 'boolean'
      ? { enabled: reconnectOption }
      : reconnectOption ?? { enabled: true };

  return {
    reconnect: {
      enabled: reconnectConfig.enabled ?? true,
      attempts: reconnectConfig.attempts ?? Infinity,
      interval: reconnectConfig.interval ?? DEFAULT_RECONNECT_INTERVAL,
      backoff: reconnectConfig.backoff ?? 'exponential',
      maxInterval: reconnectConfig.maxInterval ?? DEFAULT_MAX_RECONNECT_INTERVAL,
    },
    buffer: {
      receive: {
        size: options.buffer?.receive?.size ?? DEFAULT_BUFFER_SIZE,
        overflow: options.buffer?.receive?.overflow ?? 'oldest',
      },
      send: {
        size: options.buffer?.send?.size ?? DEFAULT_BUFFER_SIZE,
        overflow: options.buffer?.send?.overflow ?? 'oldest',
      },
    },
    url: options.url,
    protocols: options.protocols,
  };
}

/**
 * Create initial socket state with all fields initialized to default values
 * 
 * @returns New InternalSocketState instance with all fields initialized
 */
export function createState<Incoming = string>(): InternalSocketState<Incoming> {
  return {
    ws: null,
    isManualClose: false,
    reconnectCount: 0,
    reconnectTimer: null,
    messageBuffer: [],
    eventQueue: [],
    messageQueue: [],
    messageCallbacks: new Set(),
    eventCallbacks: new Set(),
    abortController: null,
    activeMessageIterators: 0,
    activeEventIterators: 0,
    messageResolvers: new Set(),
    eventResolvers: new Set(),
  };
}

/**
 * Parse message data, attempting JSON parse first, falling back to string
 * 
 * Tries to parse the input as JSON. If parsing fails, returns the string as-is.
 * This allows the function to work with both JSON and plain string messages.
 * 
 * @param data - Raw message data as string
 * @returns Parsed message (JSON object/array if valid JSON, otherwise string)
 */
export function parseMessage<Incoming>(data: string): Incoming {
  try {
    return JSON.parse(data) as Incoming;
  } catch {
    // If not JSON, use string as-is (for Incoming = string case)
    return data as unknown as Incoming;
  }
}

/**
 * Serialize outgoing message data to string, ArrayBuffer, or Blob
 * 
 * Converts objects to JSON strings, leaves other types as-is.
 * 
 * @param data - Outgoing message data
 * @returns Serialized message ready for WebSocket.send()
 */
export function serializeMessage<Outgoing>(
  data: Outgoing
): string | ArrayBuffer | Blob {
  if (
    typeof data === 'object' &&
    !(data instanceof ArrayBuffer) &&
    !(data instanceof Blob)
  ) {
    return JSON.stringify(data);
  }
  return data as string | ArrayBuffer | Blob;
}

/**
 * Handle buffer overflow according to policy
 * 
 * @param policy - Overflow policy: 'oldest', 'newest', or 'error'
 * @param buffer - The buffer array
 * @param newItem - New item to potentially add
 * @param bufferSize - Maximum buffer size
 * @param bufferType - Type of buffer ('receive' or 'send')
 * @returns Object with action: 'drop_oldest' | 'drop_newest' | 'error' | 'add', and dropped item if any
 */
export function handleBufferOverflow<T>(
  policy: BufferOverflowPolicy,
  buffer: T[],
  newItem: T,
  bufferSize: number,
  bufferType: 'receive' | 'send'
): {
  action: 'drop_oldest' | 'drop_newest' | 'error' | 'add';
  dropped?: T;
} {
  if (buffer.length < bufferSize) {
    return { action: 'add' };
  }

  if (policy === 'oldest') {
    const dropped = buffer.shift();
    return { action: 'drop_oldest', dropped };
  }

  if (policy === 'newest') {
    return { action: 'drop_newest', dropped: newItem };
  }

  // error policy
  return { action: 'error' };
}

/**
 * Create a dropped event for buffer overflow
 * 
 * @param reason - Reason for dropping ('buffer_full' | 'buffer_overflow' | 'send_queue_full' | 'send_queue_overflow')
 * @param policy - Overflow policy that was applied
 * @param droppedMessage - The message that was dropped
 * @param bufferSize - Maximum buffer size
 * @param bufferType - Type of buffer ('receive' | 'send')
 * @returns SocketEvent for the dropped message
 */
export function createDroppedEvent(
  reason: 'buffer_full' | 'buffer_overflow' | 'send_queue_full' | 'send_queue_overflow',
  policy: BufferOverflowPolicy,
  droppedMessage: string | undefined,
  bufferSize: number,
  bufferType: 'receive' | 'send'
): SocketEvent {
  return createEvent('dropped', {
    reason,
    policy,
    droppedMessage,
    bufferSize,
    bufferType,
  });
}

/**
 * Wait for new items using event-based notification with polling fallback
 * 
 * This utility function provides an efficient way to wait for items to become available
 * in a collection. It uses event-based notification when possible, with polling as a fallback.
 * 
 * @param signal - Optional AbortSignal to cancel the wait
 * @param hasItems - Function to check if items are available
 * @param resolvers - Set of resolver functions for event-based notification
 * @param addResolver - Function to add a resolver to the set
 * @param removeResolver - Function to remove a resolver from the set
 * @returns Promise that resolves when items become available or signal is aborted
 */
export function waitForItems<T>(
  signal: AbortSignal | undefined,
  hasItems: () => boolean,
  resolvers: Set<() => void>,
  addResolver: (resolve: () => void) => void,
  removeResolver: (resolve: () => void) => void
): Promise<void> {
  return new Promise<void>((resolve) => {
    let checkInterval: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      removeResolver(doResolve);
      if (checkInterval !== null) {
        clearTimeout(checkInterval);
        checkInterval = null;
      }
    };

    const doResolve = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve();
    };

    const abortHandler = () => doResolve();

    // Check if already aborted
    if (signal?.aborted) {
      doResolve();
      return;
    }

    // Listen for abort event
    if (signal) {
      signal.addEventListener('abort', abortHandler);
    }

    // Check if items already available
    if (hasItems()) {
      doResolve();
      return;
    }

    // Register resolver for immediate notification
    addResolver(doResolve);

    // Fallback polling only if no AbortSignal
    if (!signal) {
      const poll = () => {
        if (resolved) return;
        if (hasItems()) {
          doResolve();
          return;
        }
        checkInterval = setTimeout(poll, POLLING_INTERVAL_MS) as any;
      };
      poll();
    }
  });
}
