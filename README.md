# purrcat

[![Build Status](https://github.com/let-sunny/purrcat/workflows/CI/badge.svg)](https://github.com/let-sunny/purrcat/actions)
[![npm version](https://img.shields.io/npm/v/purrcat.svg)](https://www.npmjs.com/package/purrcat)
[![gzip size](https://img.shields.io/badge/gzip-~2KB-brightgreen)](https://bundlephobia.com/package/purrcat)

> Lightweight WebSocket client with auto-reconnect, backoff strategies, bounded message buffering, and async iterables

A lightweight, event-driven WebSocket client library. Perfect for real-time applications that need reliable connections with automatic reconnection and message buffering.

## Highlights

**Microscopic**: weighs less than 6KB minified (~2KB gzipped)

**Reliable**: automatic reconnection with exponential/linear backoff + jitter

**Modern**: async iterables for generator-based message streams

**Type-Safe**: full TypeScript support with generic message types

**Zero Dependencies**: uses native WebSocket API only

**Flexible**: callback-based or generator-based APIs, your choice

## Features

- **Automatic reconnection** with exponential/linear backoff + jitter
- **Bounded message buffer** with configurable overflow policies
- **Generator-based streams** for async iteration
- **TypeScript** support
- **Browser & Node.js** compatible (Node.js 18+ required for native WebSocket)
- **Zero dependencies** (uses native WebSocket API)
- **Tiny bundle size**
- **AbortSignal** support for stream cancellation

## Installation

```bash
npm install purrcat
```

### Requirements

**Runtime (when using the library):**
- **Browser**: Modern browsers with WebSocket support
- **Node.js**: 18.0.0 or higher (uses native WebSocket API)

**Development:**
- **Node.js**: 24.13.0 (tested with this version)

## Usage

### Type-Safe Messages (Generic Types)

You can define your own message types for type safety:

```typescript
import createSocket from 'purrcat';

// Define your message types
type Incoming = 
  | { type: 'message'; from: string; text: string; id: string }
  | { type: 'user_joined'; userId: string; name: string };

type Outgoing = 
  | { type: 'send_message'; text: string }
  | { type: 'join_room'; roomId: string };

// Create socket with type parameters
const socket = createSocket<Incoming, Outgoing>({
  url: 'wss://example.com/ws',
});

// Type-safe message receiving
for await (const msg of socket.messages()) {
  if (msg.type === 'message') {
    console.log(msg.from);  // ✅ TypeScript knows this exists
    console.log(msg.text);  // ✅ Type-safe
  }
}

// Type-safe message sending
socket.send({ type: 'send_message', text: 'hello' }); // ✅
socket.send({ type: 'send_message', from: 'user' }); // ❌ Type error!
```

### Generator-based Streams

```typescript
import createSocket from 'purrcat';

const socket = createSocket({
  url: 'wss://echo.websocket.org',
});

// Consume messages as async iterable
(async () => {
  for await (const message of socket.messages()) {
    console.log('Received:', message);
  }
})();

// Consume events as async iterable
(async () => {
  for await (const event of socket.events()) {
    console.log('Event:', event.type, event.ts);
  }
})();

socket.send({ type: 'hello', message: 'world' });

// Send multiple messages from a stream
async function* messageGenerator() {
  yield { type: 'ping' };
  yield { type: 'pong' };
  yield { type: 'ping' };
}

await socket.sendMessages(messageGenerator());
```

### With AbortSignal

```typescript
const controller = new AbortController();

(async () => {
  for await (const message of socket.messages({ signal: controller.signal })) {
    console.log(message);
    if (shouldStop) {
      controller.abort();
    }
  }
})();
```

### Callback-based API

```typescript
const socket = createSocket({
  url: 'wss://example.com/ws',
});

// Subscribe to messages
const unsubscribeMessage = socket.onMessage((data) => {
  console.log('Message:', data);
});

// Subscribe to events
const unsubscribeEvent = socket.onEvent((event) => {
  console.log('Event:', event.type, event.meta);
});

// Unsubscribe when done
unsubscribeMessage();
unsubscribeEvent();
```

### Reconnection Options

```typescript
const socket = createSocket({
  url: 'wss://example.com/ws',
  reconnect: {
    enabled: true,
    attempts: 10,
    interval: 1000,
    backoff: 'exponential', // or 'linear'
    maxInterval: 30000,
  },
});

// Or simply use boolean
const socket2 = createSocket({
  url: 'wss://example.com/ws',
  reconnect: true, // Uses default reconnect config
});
```

### Bounded Buffer with Overflow Policy

```typescript
const socket = createSocket({
  url: 'wss://example.com/ws',
  buffer: {
    receive: {
      size: 100, // Maximum receive buffer size
      overflow: 'oldest', // or 'newest' or 'error'
    },
    send: {
      size: 50, // Maximum send queue size
      overflow: 'newest', // or 'oldest' or 'error'
    },
  },
});

// Listen for dropped messages
socket.onEvent((event) => {
  if (event.type === 'dropped') {
    console.warn('Message dropped:', event.meta?.reason, event.meta?.bufferType);
  }
});
```

### Manual Connection Control

```typescript
const socket = createSocket({
  url: 'wss://example.com/ws',
  reconnect: false, // Disable auto-connect
});

// Connect manually
socket.connect();

// Close connection
socket.close(1000, 'Normal closure');
```

## API

### `createSocket(options)`

Creates a new WebSocket client instance.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | **required** | WebSocket server URL |
| `protocols` | `string \| string[]` | - | WebSocket subprotocols |
| `reconnect` | `boolean \| ReconnectConfig` | `true` | Reconnection configuration. `ReconnectConfig` is `{ enabled?: boolean, attempts?: number, interval?: number, backoff?: ReconnectBackoff, maxInterval?: number }` |
| `buffer` | `{ receive?: BufferConfig, send?: BufferConfig }` | `{ receive: { size: 100, overflow: 'oldest' }, send: { size: 100, overflow: 'oldest' } }` | Message buffer configuration (receive buffer and send queue). `BufferConfig` is `{ size?: number, overflow?: BufferOverflowPolicy }` |

### Socket Methods

#### `messages({ signal? })`

Returns an async iterable of messages. Messages are buffered and yielded in order.

```typescript
for await (const message of socket.messages({ signal: abortSignal })) {
  console.log(message);
}
```

#### `events({ signal? })`

Returns an async iterable of socket events.

```typescript
for await (const event of socket.events({ signal: abortSignal })) {
  console.log(event.type, event.ts, event.meta);
}
```

#### `onMessage(callback)`

Registers a message callback. Returns an unsubscribe function.

```typescript
const unsubscribe = socket.onMessage((data) => {
  console.log(data);
});
// Later...
unsubscribe();
```

#### `onEvent(callback)`

Registers an event callback. Returns an unsubscribe function.

```typescript
const unsubscribe = socket.onEvent((event) => {
  console.log(event.type);
});
// Later...
unsubscribe();
```

#### `send(data)`

Sends a message to the server. Automatically stringifies objects.

```typescript
socket.send('Hello');
socket.send({ type: 'message', text: 'Hello' });
socket.send(new ArrayBuffer(8));
```

#### `sendMessages(messages, options?)`

Sends multiple messages from an async iterable stream. Returns a Promise that resolves when all messages are sent.

```typescript
const messages = [
  { type: 'ping' },
  { type: 'pong' },
  { type: 'ping' },
];

// Using async generator
async function* messageStream() {
  for (const msg of messages) {
    yield msg;
  }
}

await socket.sendMessages(messageStream());

// With AbortSignal
const controller = new AbortController();
await socket.sendMessages(messageStream(), { signal: controller.signal });
```

#### `connect()`

Manually connect to the WebSocket server.

```typescript
socket.connect();
```

#### `close(code?, reason?)`

Closes the WebSocket connection. Prevents automatic reconnection.

```typescript
socket.close(1000, 'Normal closure');
```

### SocketEvent Types

- `open` - Connection opened
- `close` - Connection closed (meta: `{ code, reason, wasClean }`). `wasClean` indicates whether the connection closed cleanly (true) or abnormally (false, e.g., network failure)
- `error` - Error occurred
- `reconnect` - Reconnection scheduled or attempt started (meta: `{ attempt, interval? }`). If `interval` is present, it's scheduled; otherwise, it's an attempt in progress
- `received` - Message received from server (meta: `{ message }`)
- `sent` - Message sent to server (meta: `{ message }`)
- `dropped` - Message dropped due to buffer overflow (meta: `{ reason }`)

### SocketEvent Structure

```typescript
interface SocketEvent {
  type: SocketEventType;
  ts: number; // Timestamp in milliseconds
  meta?: Record<string, any>; // Additional metadata
}
```

## Examples

### Complete Example

```typescript
import createSocket from 'purrcat';

const socket = createSocket({
  url: 'wss://api.example.com/ws',
  reconnect: {
    enabled: true,
    attempts: 10,
  },
  buffer: {
    receive: {
      size: 50,
      overflow: 'oldest',
    },
    send: {
      size: 50,
      overflow: 'oldest',
    },
  },
});

// Handle events
socket.onEvent((event) => {
  switch (event.type) {
    case 'open':
      console.log('Connected');
      break;
    case 'close':
      const { code, reason, wasClean } = event.meta || {};
      if (wasClean) {
        console.log('Disconnected normally', { code, reason });
      } else {
        console.log('Disconnected abnormally (network issue?)', { code, reason });
      }
      break;
    case 'error':
      console.error('Error:', event.meta?.error);
      break;
    case 'reconnect':
      if (event.meta?.interval) {
        console.log(`Reconnecting in ${event.meta.interval}ms (attempt ${event.meta.attempt})`);
      } else {
        console.log(`Reconnecting (attempt ${event.meta?.attempt})`);
      }
      break;
    case 'dropped':
      console.warn('Message dropped:', event.meta?.reason);
      break;
  }
});

// Process messages
(async () => {
  for await (const message of socket.messages()) {
    // message is already parsed (Incoming type)
    console.log('Received:', message);
  }
})();

// Send messages
socket.send({ type: 'ping' });
```

## License

MIT
