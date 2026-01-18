/** Event types emitted by socket, used in SocketEvent.type and createEvent() */
export type SocketEventType =
  | 'open'
  | 'close'
  | 'error'
  | 'reconnect'
  | 'received'
  | 'sent'
  | 'dropped';

/** Policy for handling buffer overflow when receive/send queues are full, used in BufferConfig.overflow */
export type BufferOverflowPolicy = 'oldest' | 'newest' | 'error';

/** Strategy for increasing reconnect delay, used in ReconnectConfig.backoff and calculateReconnectInterval() */
export type ReconnectBackoff = 'linear' | 'exponential';

/** Buffer configuration shared by receive buffer and send queue, used in SocketOptions.buffer */
export interface BufferConfig {
  size?: number;
  overflow?: BufferOverflowPolicy;
}

/** Reconnection settings, used in SocketOptions.reconnect (can be boolean for simple enable/disable) */
export interface ReconnectConfig {
  enabled?: boolean;
  attempts?: number;
  interval?: number;
  backoff?: ReconnectBackoff;
  maxInterval?: number;
}

/** Event structure emitted via events() generator and onEvent() callbacks */
export interface SocketEvent {
  type: SocketEventType;
  ts: number;
  meta?: Record<string, any>;
}

/** Options passed to createSocket() to configure the WebSocket client */
export interface SocketOptions {
  url: string;
  /** WebSocket subprotocol(s) to negotiate with server, passed as second argument to WebSocket constructor */
  protocols?: string | string[];
  reconnect?: boolean | ReconnectConfig;
  buffer?: {
    receive?: BufferConfig;
    send?: BufferConfig;
  };
}

/** Return type of createSocket(), provides async iterables and callbacks for messages/events */
export interface Socket<Incoming = string, Outgoing = string | object | ArrayBuffer | Blob> {
  messages(options?: { signal?: AbortSignal }): AsyncIterable<Incoming>;
  events(options?: { signal?: AbortSignal }): AsyncIterable<SocketEvent>;
  onMessage(callback: (data: Incoming) => void): () => void;
  onEvent(callback: (event: SocketEvent) => void): () => void;
  connect(): void;
  close(code?: number, reason?: string): void;
  send(data: Outgoing): void;
  sendMessages(
    messages: AsyncIterable<Outgoing>,
    options?: { signal?: AbortSignal }
  ): Promise<void>;
}

/** Internal state managed by createSocket(), not exposed to users */
export interface InternalSocketState<Incoming = string> {
  ws: WebSocket | null;
  isManualClose: boolean;
  reconnectCount: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  messageBuffer: string[];
  eventQueue: SocketEvent[];
  messageQueue: string[];
  messageCallbacks: Set<(data: Incoming) => void>;
  eventCallbacks: Set<(event: SocketEvent) => void>;
  abortController: AbortController | null;
  activeMessageIterators: number;
  activeEventIterators: number;
}

/** Normalized options returned by normalizeOptions(), all fields are required with defaults applied */
export interface NormalizedSocketOptions {
  reconnect: Required<ReconnectConfig>;
  buffer: {
    receive: Required<BufferConfig>;
    send: Required<BufferConfig>;
  };
  url: string;
  protocols?: string | string[];
}
