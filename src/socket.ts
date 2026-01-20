import type {
  SocketOptions,
  Socket as SocketInterface,
  SocketEvent,
  InternalSocketState,
  NormalizedSocketOptions,
} from './types.js';
import { normalizeOptions, createState } from './utils.js';
import { messagesGenerator, eventsGenerator } from './generators.js';
import { EventHandler } from './handlers/event-handler.js';
import { MessageHandler } from './handlers/message-handler.js';
import { ConnectionHandler } from './handlers/connection-handler.js';

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
export function createSocket<Incoming = string, Outgoing = string | object | ArrayBuffer | Blob>(
  options: SocketOptions
): SocketInterface<Incoming, Outgoing> {
  const opts = normalizeOptions(options);
  const state = createState<Incoming>();

  const socket = new Socket<Incoming, Outgoing>(state, opts);

  // Auto-connect by default
  socket.connect();

  return socket;
}

/**
 * Main Socket implementation that combines EventHandler, MessageHandler, and ConnectionHandler
 */
class Socket<Incoming, Outgoing> implements SocketInterface<Incoming, Outgoing> {
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
