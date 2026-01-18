import type { SocketEvent, InternalSocketState } from './types.js';

export async function* messagesGenerator<Incoming = string>(
  state: InternalSocketState<Incoming>,
  signal?: AbortSignal
): AsyncGenerator<Incoming> {
  // Track that we have an active iterator
  state.activeMessageIterators++;

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      // Yield buffered messages (consume from front)
      while (state.messageBuffer.length > 0) {
        if (signal?.aborted) {
          break;
        }
        // Remove and parse the oldest message
        const messageStr = state.messageBuffer.shift()!;
        // Parse JSON if possible, otherwise use string as-is
        let parsed: Incoming;
        try {
          parsed = JSON.parse(messageStr) as Incoming;
        } catch {
          // If not JSON, use string as-is (for Incoming = string case)
          parsed = messageStr as unknown as Incoming;
        }
        yield parsed;
      }

      // Wait for new messages
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (signal?.aborted) {
            clearInterval(checkInterval);
            resolve();
            return;
          }

          if (state.messageBuffer.length > 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);
      });
    }
  } finally {
    // Decrement active iterator count
    state.activeMessageIterators--;
    // If no more iterators, clear the buffer to prevent memory leak
    if (state.activeMessageIterators === 0) {
      state.messageBuffer = [];
    }
  }
}

export async function* eventsGenerator<Incoming = string>(
  state: InternalSocketState<Incoming>,
  signal?: AbortSignal
): AsyncGenerator<SocketEvent> {
  // Track that we have an active iterator
  state.activeEventIterators++;

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      // Yield queued events (consume from front)
      while (state.eventQueue.length > 0) {
        if (signal?.aborted) {
          break;
        }
        // Remove and yield the oldest event
        const event = state.eventQueue.shift()!;
        yield event;
      }

      // Wait for new events
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (signal?.aborted) {
            clearInterval(checkInterval);
            resolve();
            return;
          }

          if (state.eventQueue.length > 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);
      });
    }
  } finally {
    // Decrement active iterator count
    state.activeEventIterators--;
    // Note: We don't clear eventQueue when no iterators because
    // events might be consumed by callbacks, and new iterators might
    // want to see recent events. But we could add a max size if needed.
  }
}
