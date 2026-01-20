import type { SocketEvent, InternalSocketState } from './types.js';
import { waitForItems, parseMessage } from './utils.js';

/**
 * Async generator for consuming messages from the socket
 *
 * Yields messages from the message buffer as they arrive. Automatically manages
 * buffer lifecycle - clears buffer when no active iterators remain.
 *
 * @param state - Internal socket state containing message buffer and resolvers
 * @param signal - Optional AbortSignal to cancel message consumption
 * @yields Parsed incoming messages (JSON parsed if possible, otherwise string)
 */
export async function* messagesGenerator<Incoming = string>(
  state: InternalSocketState<Incoming>,
  signal?: AbortSignal
): AsyncGenerator<Incoming> {
  state.activeMessageIterators++;

  try {
    while (true) {
      if (signal?.aborted) break;

      // Yield buffered messages
      while (state.messageBuffer.length > 0) {
        if (signal?.aborted) break;

        const messageStr = state.messageBuffer.shift()!;
        const parsed = parseMessage<Incoming>(messageStr);
        yield parsed;
      }

      // Wait for new messages
      await waitForItems(
        signal,
        () => state.messageBuffer.length > 0,
        state.messageResolvers,
        resolve => state.messageResolvers.add(resolve),
        resolve => state.messageResolvers.delete(resolve)
      );
    }
  } finally {
    state.activeMessageIterators--;
    if (state.activeMessageIterators === 0) {
      state.messageBuffer = [];
    }
  }
}

/**
 * Async generator for consuming events from the socket
 *
 * Yields events from the event queue as they occur. Automatically manages
 * queue lifecycle - clears queue when no active iterators remain.
 *
 * @param state - Internal socket state containing event queue and resolvers
 * @param signal - Optional AbortSignal to cancel event consumption
 * @yields SocketEvent objects representing connection events, messages, and errors
 */
export async function* eventsGenerator<Incoming = string>(
  state: InternalSocketState<Incoming>,
  signal?: AbortSignal
): AsyncGenerator<SocketEvent> {
  state.activeEventIterators++;

  try {
    while (true) {
      if (signal?.aborted) break;

      // Yield queued events
      while (state.eventQueue.length > 0) {
        if (signal?.aborted) break;
        yield state.eventQueue.shift()!;
      }

      // Wait for new events
      await waitForItems(
        signal,
        () => state.eventQueue.length > 0,
        state.eventResolvers,
        resolve => state.eventResolvers.add(resolve),
        resolve => state.eventResolvers.delete(resolve)
      );
    }
  } finally {
    state.activeEventIterators--;
    // Clear event queue when no iterators to prevent memory leak
    if (state.activeEventIterators === 0) {
      state.eventQueue = [];
    }
  }
}
