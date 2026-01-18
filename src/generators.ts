import type { SocketEvent, InternalSocketState } from './types.js';

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
        let parsed: Incoming;
        try {
          parsed = JSON.parse(messageStr) as Incoming;
        } catch {
          parsed = messageStr as unknown as Incoming;
        }
        yield parsed;
      }

      // Wait for new messages
      await waitForItems(
        signal,
        () => state.messageBuffer.length > 0,
        state.messageResolvers,
        (resolve) => state.messageResolvers.add(resolve),
        (resolve) => state.messageResolvers.delete(resolve)
      );
    }
  } finally {
    state.activeMessageIterators--;
    if (state.activeMessageIterators === 0) {
      state.messageBuffer = [];
    }
  }
}

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
        (resolve) => state.eventResolvers.add(resolve),
        (resolve) => state.eventResolvers.delete(resolve)
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


/**
 * Wait for new items using event-based notification with polling fallback
 */
function waitForItems<T>(
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
        checkInterval = setTimeout(poll, 100) as any;
      };
      poll();
    }
  });
}
