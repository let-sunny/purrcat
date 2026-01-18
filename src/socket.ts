import type {
  SocketOptions,
  Socket,
  SocketEvent,
  InternalSocketState,
  NormalizedSocketOptions,
} from './types.js';
import {
  createEvent,
  calculateReconnectInterval,
  normalizeOptions,
  createState,
  parseMessage,
  serializeMessage,
  handleBufferOverflow,
  createDroppedEvent,
} from './utils.js';
import { messagesGenerator, eventsGenerator } from './generators.js';
import { MAX_RECENT_EVENTS } from './constants.js';

/**
 * Create a WebSocket client with auto-reconnect, buffering, and async iterables
 * 
 * Creates a new WebSocket client instance with the provided options. The socket
 * automatically connects on creation and provides both callback-based and
 * generator-based APIs for consuming messages and events.
 * 
 * @param options - Socket configuration options
 * @param options.url - WebSocket server URL (required)
 * @param options.protocols - Optional WebSocket subprotocol(s)
 * @param options.reconnect - Reconnection configuration (boolean or ReconnectConfig)
 * @param options.buffer - Buffer configuration for receive and send queues
 * @returns Socket instance with methods for sending/receiving messages and events
 * 
 * @example
 * ```typescript
 * const socket = createSocket({ url: 'wss://example.com' });
 * 
 * // Generator-based API
 * for await (const msg of socket.messages()) {
 *   console.log(msg);
 * }
 * 
 * // Callback-based API
 * socket.onMessage((msg) => console.log(msg));
 * ```
 */
export function createSocket<
  Incoming = string,
  Outgoing = string | object | ArrayBuffer | Blob
>(options: SocketOptions): Socket<Incoming, Outgoing> {
  const opts = normalizeOptions(options);
  const state = createState<Incoming>();

  const socket = new SocketImpl<Incoming, Outgoing>(state, opts);

  // Auto-connect by default
  socket.connect();

  return socket;
}


/**
 * Handles event emission and queue management
 */
class EventHandler<Incoming> {
  constructor(private state: InternalSocketState<Incoming>) {}

  emit(event: SocketEvent): void {
    // Call all registered callbacks first (they don't use queue)
    this.state.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('Error in event callback:', error);
      }
    });

    // Queue events for iterators
    if (this.state.activeEventIterators > 0) {
      // Active iterators exist - add to queue and notify
      this.state.eventQueue.push(event);
      // Notify waiting iterators immediately
      // Copy the set to avoid issues if new resolvers are added during iteration
      const resolvers = Array.from(this.state.eventResolvers);
      this.state.eventResolvers.clear();
      resolvers.forEach((resolve) => resolve());
      return;
    }

    // No active iterators - keep only recent events for when iterators start
    // This allows new iterators to receive recent events without memory leak
    this.state.eventQueue.push(event);
    if (this.state.eventQueue.length > MAX_RECENT_EVENTS) {
      this.state.eventQueue.shift(); // Remove oldest event
    }
  }
}

/**
 * Handles message receiving, sending, and buffering
 */
class MessageHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>
  ) {}

  receive(data: string): void {
    // Parse JSON if possible, otherwise use string as-is
    const parsed = parseMessage<Incoming>(data);

    // Emit received event
    this.eventHandler.emit(
      createEvent('received', {
        message: parsed,
      })
    );

    // Handle callbacks and buffering
    this.handleCallbacks(parsed);
    this.bufferReceivedMessage(data);
  }

  async receiveMessages(
    messages: AsyncIterable<string>,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const signal = options?.signal;

    try {
      for await (const message of messages) {
        if (signal?.aborted) {
          break;
        }
        this.receive(message);
      }
    } catch (error) {
      if (signal?.aborted) {
        // AbortSignal cancellation is considered normal termination
        return;
      }
      throw error;
    }
  }

  send(data: Outgoing): void {
    const message = serializeMessage(data);

    // Try to send immediately if connected
    if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
      this.handleSendImmediately(message, data);
      return;
    }

    // Buffer for later
    const messageStr =
      typeof message === 'string' ? message : String(message);
    this.queueSendMessage(messageStr);
  }

  async sendMessages(
    messages: AsyncIterable<Outgoing>,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const signal = options?.signal;

    try {
      for await (const message of messages) {
        if (signal?.aborted) {
          break;
        }
        this.send(message);
      }
    } catch (error) {
      if (signal?.aborted) {
        // AbortSignal cancellation is considered normal termination
        return;
      }
      throw error;
    }
  }

  flushQueue(): void {
    if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.state.messageQueue.length > 0) {
      const message = this.state.messageQueue.shift();
      if (message) {
        this.state.ws.send(message);
        // Emit sent event for queued messages
        this.eventHandler.emit(
          createEvent('sent', {
            message: message,
          })
        );
      }
    }
  }

  private handleCallbacks(parsed: Incoming): void {
    // Call all registered callbacks first (they don't use buffer)
    this.state.messageCallbacks.forEach((cb) => {
      try {
        cb(parsed);
      } catch (error) {
        console.error('Error in message callback:', error);
      }
    });
  }

  private bufferReceivedMessage(data: string): void {
    // Only buffer if there are active iterators consuming messages
    if (this.state.activeMessageIterators === 0) {
      return;
    }

    const overflowResult = handleBufferOverflow(
      this.opts.buffer.receive.overflow,
      this.state.messageBuffer,
      data,
      this.opts.buffer.receive.size,
      'receive'
    );

    if (overflowResult.action === 'error') {
      this.eventHandler.emit(
        createDroppedEvent(
          'buffer_overflow',
          this.opts.buffer.receive.overflow,
          undefined,
          this.opts.buffer.receive.size,
          'receive'
        )
      );
      throw new Error('Message buffer overflow');
    }

    if (overflowResult.action === 'drop_newest') {
      this.eventHandler.emit(
        createDroppedEvent(
          'buffer_full',
          this.opts.buffer.receive.overflow,
          overflowResult.dropped,
          this.opts.buffer.receive.size,
          'receive'
        )
      );
      return;
    }

    if (overflowResult.action === 'drop_oldest') {
      this.eventHandler.emit(
        createDroppedEvent(
          'buffer_full',
          this.opts.buffer.receive.overflow,
          overflowResult.dropped,
          this.opts.buffer.receive.size,
          'receive'
        )
      );
      // drop_oldest already removed oldest item, now add new one
      this.state.messageBuffer.push(data);
      // Notify waiting iterators immediately
      const resolvers = Array.from(this.state.messageResolvers);
      this.state.messageResolvers.clear();
      resolvers.forEach((resolve) => resolve());
      return;
    }

    // Normal case: add to buffer
    if (overflowResult.action === 'add') {
      this.state.messageBuffer.push(data);
      // Notify waiting iterators immediately
      // Copy the set to avoid issues if new resolvers are added during iteration
      const resolvers = Array.from(this.state.messageResolvers);
      this.state.messageResolvers.clear();
      resolvers.forEach((resolve) => resolve());
    }
  }

  private handleSendImmediately(message: string | ArrayBuffer | Blob, data: Outgoing): void {
    if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.state.ws.send(message);
    // Emit sent event
    this.eventHandler.emit(
      createEvent('sent', {
        message: data,
      })
    );
  }

  private queueSendMessage(messageStr: string): void {
    const overflowResult = handleBufferOverflow(
      this.opts.buffer.send.overflow,
      this.state.messageQueue,
      messageStr,
      this.opts.buffer.send.size,
      'send'
    );

    if (overflowResult.action === 'error') {
      this.eventHandler.emit(
        createDroppedEvent(
          'send_queue_overflow',
          this.opts.buffer.send.overflow,
          undefined,
          this.opts.buffer.send.size,
          'send'
        )
      );
      throw new Error('Send queue overflow');
    }

    if (overflowResult.action === 'drop_newest') {
      this.eventHandler.emit(
        createDroppedEvent(
          'send_queue_full',
          this.opts.buffer.send.overflow,
          overflowResult.dropped,
          this.opts.buffer.send.size,
          'send'
        )
      );
      return;
    }

    if (overflowResult.action === 'drop_oldest') {
      this.eventHandler.emit(
        createDroppedEvent(
          'send_queue_full',
          this.opts.buffer.send.overflow,
          overflowResult.dropped,
          this.opts.buffer.send.size,
          'send'
        )
      );
      // drop_oldest already removed oldest item, now add new one
      this.state.messageQueue.push(messageStr);
      return;
    }

    if (overflowResult.action === 'add') {
      this.state.messageQueue.push(messageStr);
    }
  }
}

/**
 * Handles WebSocket connection, reconnection, and lifecycle management
 */
class ConnectionHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>,
    private messageHandler: MessageHandler<Incoming, Outgoing>
  ) {}

  scheduleReconnect(): void {
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
    }

    if (this.state.reconnectCount >= this.opts.reconnect.attempts) {
      return;
    }

    const interval = calculateReconnectInterval(
      this.state.reconnectCount,
      this.opts.reconnect.interval,
      this.opts.reconnect.backoff,
      this.opts.reconnect.maxInterval
    );

    this.eventHandler.emit(
      createEvent('reconnect', {
        attempt: this.state.reconnectCount + 1,
        interval,
      })
    );

    this.state.reconnectTimer = setTimeout(() => {
      this.state.reconnectCount++;
      this.eventHandler.emit(
        createEvent('reconnect', {
          attempt: this.state.reconnectCount,
        })
      );
      this.connect();
    }, interval);
  }

  connect(): void {
    if (this.state.abortController?.signal.aborted) {
      return;
    }

    try {
      this.state.ws = this.opts.protocols
        ? new WebSocket(this.opts.url, this.opts.protocols)
        : new WebSocket(this.opts.url);

      this.state.ws.onopen = () => {
        this.state.reconnectCount = 0;
        this.eventHandler.emit(createEvent('open'));
        this.messageHandler.flushQueue();
      };

      this.state.ws.onmessage = (event) => {
        const data =
          typeof event.data === 'string' ? event.data : String(event.data);
        this.messageHandler.receive(data);
      };

      this.state.ws.onerror = (error) => {
        this.eventHandler.emit(createEvent('error', { error }));
      };

      this.state.ws.onclose = (event) => {
        this.eventHandler.emit(
          createEvent('close', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          })
        );
        if (
          !this.state.isManualClose &&
          this.opts.reconnect.enabled &&
          this.state.reconnectCount < this.opts.reconnect.attempts
        ) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      this.eventHandler.emit(createEvent('error', { error }));
      if (
        this.opts.reconnect.enabled &&
        this.state.reconnectCount < this.opts.reconnect.attempts
      ) {
        this.scheduleReconnect();
      }
    }
  }

  close(code?: number, reason?: string): void {
    this.state.isManualClose = true;
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
      this.state.reconnectTimer = null;
    }
    if (this.state.ws) {
      this.state.ws.close(code, reason);
      this.state.ws = null;
    }
    if (this.state.abortController) {
      this.state.abortController.abort();
      this.state.abortController = null;
    }
    this.state.messageQueue = [];
  }
}

/**
 * Main Socket implementation that combines EventHandler, MessageHandler, and ConnectionHandler
 */
class SocketImpl<Incoming, Outgoing> implements Socket<Incoming, Outgoing> {
  private eventHandler: EventHandler<Incoming>;
  private messageHandler: MessageHandler<Incoming, Outgoing>;
  private connectionHandler: ConnectionHandler<Incoming, Outgoing>;

  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions
  ) {
    // Create handlers in dependency order
    this.eventHandler = new EventHandler<Incoming>(this.state);

    this.messageHandler = new MessageHandler<Incoming, Outgoing>(
      this.state,
      this.opts,
      this.eventHandler
    );

    this.connectionHandler = new ConnectionHandler<Incoming, Outgoing>(
      this.state,
      this.opts,
      this.eventHandler,
      this.messageHandler
    );
  }

  messages(options?: { signal?: AbortSignal }): AsyncIterable<Incoming> {
    const signal = options?.signal;
    return messagesGenerator<Incoming>(this.state, signal);
  }

  events(options?: { signal?: AbortSignal }): AsyncIterable<SocketEvent> {
    const signal = options?.signal;
    return eventsGenerator<Incoming>(this.state, signal);
  }

  onMessage(callback: (data: Incoming) => void): () => void {
    this.state.messageCallbacks.add(callback);
    return () => {
      this.state.messageCallbacks.delete(callback);
    };
  }

  onEvent(callback: (event: SocketEvent) => void): () => void {
    this.state.eventCallbacks.add(callback);
    return () => {
      this.state.eventCallbacks.delete(callback);
    };
  }

  connect(): void {
    this.connectionHandler.connect();
  }

  close(code?: number, reason?: string): void {
    this.connectionHandler.close(code, reason);
  }

  send(data: Outgoing): void {
    this.messageHandler.send(data);
  }

  async sendMessages(
    messages: AsyncIterable<Outgoing>,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.messageHandler.sendMessages(messages, options);
  }
}
