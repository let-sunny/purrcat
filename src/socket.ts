import type {
  SocketOptions,
  Socket,
  SocketEvent,
  InternalSocketState,
  NormalizedSocketOptions,
  ReconnectConfig,
} from './types.js';
import { createEvent, calculateReconnectInterval } from './utils.js';
import { messagesGenerator, eventsGenerator } from './generators.js';

function normalizeOptions(options: SocketOptions): NormalizedSocketOptions {
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
      interval: reconnectConfig.interval ?? 1000,
      backoff: reconnectConfig.backoff ?? 'exponential',
      maxInterval: reconnectConfig.maxInterval ?? 30000,
    },
    buffer: {
      receive: {
        size: options.buffer?.receive?.size ?? 100,
        overflow: options.buffer?.receive?.overflow ?? 'oldest',
      },
      send: {
        size: options.buffer?.send?.size ?? 100,
        overflow: options.buffer?.send?.overflow ?? 'oldest',
      },
    },
    url: options.url,
    protocols: options.protocols,
  };
}

function createState<Incoming = string>(): InternalSocketState<Incoming> {
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

export function createSocket<
  Incoming = string,
  Outgoing = string | object | ArrayBuffer | Blob
>(options: SocketOptions): Socket<Incoming, Outgoing> {
  const opts = normalizeOptions(options);
  const state = createState<Incoming>();

  function emitEvent(event: SocketEvent): void {
    // Call all registered callbacks first (they don't use queue)
    state.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('Error in event callback:', error);
      }
    });

    // Queue events for iterators
    if (state.activeEventIterators > 0) {
      // Active iterators exist - add to queue and notify
      state.eventQueue.push(event);
      // Notify waiting iterators immediately
      // Copy the set to avoid issues if new resolvers are added during iteration
      const resolvers = Array.from(state.eventResolvers);
      state.eventResolvers.clear();
      resolvers.forEach((resolve) => resolve());
    } else {
      // No active iterators - keep only recent events (max 10) for when iterators start
      // This allows new iterators to receive recent events without memory leak
      state.eventQueue.push(event);
      const maxRecentEvents = 10;
      if (state.eventQueue.length > maxRecentEvents) {
        state.eventQueue.shift(); // Remove oldest event
      }
    }
  }

  function emitMessage(data: string): void {
    // Parse JSON if possible, otherwise use string as-is
    let parsed: Incoming;
    try {
      parsed = JSON.parse(data) as Incoming;
    } catch {
      // If not JSON, use string as-is (for Incoming = string case)
      parsed = data as unknown as Incoming;
    }

    // Emit received event
    emitEvent(
      createEvent('received', {
        message: parsed,
      })
    );

    // Call all registered callbacks first (they don't use buffer)
    state.messageCallbacks.forEach((cb) => {
      try {
        cb(parsed);
      } catch (error) {
        console.error('Error in message callback:', error);
      }
    });

    // Only buffer if there are active iterators consuming messages
    if (state.activeMessageIterators > 0) {
      // Check buffer overflow before adding
      if (state.messageBuffer.length >= opts.buffer.receive.size) {
        if (opts.buffer.receive.overflow === 'oldest') {
          const dropped = state.messageBuffer.shift();
          emitEvent(
            createEvent('dropped', {
              reason: 'buffer_full',
              policy: 'oldest',
              droppedMessage: dropped,
              bufferSize: opts.buffer.receive.size,
              bufferType: 'receive',
            })
          );
        } else if (opts.buffer.receive.overflow === 'newest') {
          // Don't add, drop this message
          emitEvent(
            createEvent('dropped', {
              reason: 'buffer_full',
              policy: 'newest',
              droppedMessage: data,
              bufferSize: opts.buffer.receive.size,
              bufferType: 'receive',
            })
          );
          return;
        } else {
          // error policy
          emitEvent(
            createEvent('dropped', {
              reason: 'buffer_overflow',
              policy: 'error',
              bufferSize: opts.buffer.receive.size,
              bufferType: 'receive',
            })
          );
          throw new Error('Message buffer overflow');
        }
      }
      state.messageBuffer.push(data);
      // Notify waiting iterators immediately
      // Copy the set to avoid issues if new resolvers are added during iteration
      const resolvers = Array.from(state.messageResolvers);
      state.messageResolvers.clear();
      resolvers.forEach((resolve) => resolve());
    }
  }

  function scheduleReconnect(): void {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }

    if (state.reconnectCount >= opts.reconnect.attempts) {
      return;
    }

    const interval = calculateReconnectInterval(
      state.reconnectCount,
      opts.reconnect.interval,
      opts.reconnect.backoff,
      opts.reconnect.maxInterval
    );

    emitEvent(
      createEvent('reconnect', {
        attempt: state.reconnectCount + 1,
        interval,
      })
    );

    state.reconnectTimer = setTimeout(() => {
      state.reconnectCount++;
      emitEvent(
        createEvent('reconnect', {
          attempt: state.reconnectCount,
        })
      );
      connect();
    }, interval);
  }

  function connect(): void {
    if (state.abortController?.signal.aborted) {
      return;
    }

    try {
      state.ws = opts.protocols
        ? new WebSocket(opts.url, opts.protocols)
        : new WebSocket(opts.url);

      state.ws.onopen = () => {
        state.reconnectCount = 0;
        emitEvent(createEvent('open'));
        flushMessageQueue();
      };

      state.ws.onmessage = (event) => {
        const data =
          typeof event.data === 'string' ? event.data : String(event.data);
        emitMessage(data);
      };

      state.ws.onerror = (error) => {
        emitEvent(createEvent('error', { error }));
      };

      state.ws.onclose = (event) => {
        emitEvent(
          createEvent('close', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          })
        );
        if (
          !state.isManualClose &&
          opts.reconnect.enabled &&
          state.reconnectCount < opts.reconnect.attempts
        ) {
          scheduleReconnect();
        }
      };
    } catch (error) {
      emitEvent(createEvent('error', { error }));
      if (
        opts.reconnect.enabled &&
        state.reconnectCount < opts.reconnect.attempts
      ) {
        scheduleReconnect();
      }
    }
  }

  function flushMessageQueue(): void {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    while (state.messageQueue.length > 0) {
      const message = state.messageQueue.shift();
      if (message) {
        state.ws.send(message);
        // Emit sent event for queued messages
        emitEvent(
          createEvent('sent', {
            message: message,
          })
        );
      }
    }
  }

  function send(data: Outgoing): void {
    let message: string | ArrayBuffer | Blob;

    if (
      typeof data === 'object' &&
      !(data instanceof ArrayBuffer) &&
      !(data instanceof Blob)
    ) {
      message = JSON.stringify(data);
    } else {
      message = data as string | ArrayBuffer | Blob;
    }

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(message);
      // Emit sent event
      emitEvent(
        createEvent('sent', {
          message: data,
        })
      );
    } else {
      // Buffer for later
      const messageStr =
        typeof message === 'string' ? message : String(message);
      if (state.messageQueue.length >= opts.buffer.send.size) {
        if (opts.buffer.send.overflow === 'oldest') {
          const dropped = state.messageQueue.shift();
          emitEvent(
            createEvent('dropped', {
              reason: 'send_queue_full',
              policy: 'oldest',
              droppedMessage: dropped,
              bufferSize: opts.buffer.send.size,
              bufferType: 'send',
            })
          );
        } else if (opts.buffer.send.overflow === 'newest') {
          emitEvent(
            createEvent('dropped', {
              reason: 'send_queue_full',
              policy: 'newest',
              droppedMessage: messageStr,
              bufferSize: opts.buffer.send.size,
              bufferType: 'send',
            })
          );
          return;
        } else {
          emitEvent(
            createEvent('dropped', {
              reason: 'send_queue_overflow',
              policy: 'error',
              bufferSize: opts.buffer.send.size,
              bufferType: 'send',
            })
          );
          throw new Error('Send queue overflow');
        }
      }
      state.messageQueue.push(messageStr);
    }
  }

  function close(code?: number, reason?: string): void {
    state.isManualClose = true;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.ws) {
      state.ws.close(code, reason);
      state.ws = null;
    }
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    state.messageQueue = [];
  }

  async function sendMessages(
    messages: AsyncIterable<Outgoing>,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const signal = options?.signal;

    try {
      for await (const message of messages) {
        if (signal?.aborted) {
          break;
        }
        send(message);
      }
    } catch (error) {
      if (signal?.aborted) {
        // AbortSignal cancellation is considered normal termination
        return;
      }
      throw error;
    }
  }

  const socket: Socket<Incoming, Outgoing> = {
    messages(options) {
      const signal = options?.signal;
      return messagesGenerator<Incoming>(state, signal);
    },

    events(options) {
      const signal = options?.signal;
      return eventsGenerator<Incoming>(state, signal);
    },

    onMessage(callback) {
      state.messageCallbacks.add(callback);
      return () => {
        state.messageCallbacks.delete(callback);
      };
    },

    onEvent(callback) {
      state.eventCallbacks.add(callback);
      return () => {
        state.eventCallbacks.delete(callback);
      };
    },

    connect,
    close,
    send,
    sendMessages,
  };

  // Auto-connect by default
  connect();

  return socket;
}
