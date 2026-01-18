# purrcat Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [Core Design Principles](#core-design-principles)
3. [Module Structure](#module-structure)
4. [Class-Based Structure](#class-based-structure)
5. [State Management](#state-management)
6. [API Design: Callback vs Generator](#api-design-callback-vs-generator)
7. [Event System](#event-system)
8. [Generator-Based Streams](#generator-based-streams)
9. [Reconnection Mechanism](#reconnection-mechanism)
10. [Buffer Management](#buffer-management)
11. [Data Flow](#data-flow)
12. [Design Decisions](#design-decisions)
13. [Extensibility Considerations](#extensibility-considerations)
14. [Performance Considerations](#performance-considerations)
15. [Conclusion](#conclusion)

---

## Overview

purrcat is a lightweight WebSocket client library that provides auto-reconnect, backoff strategies, message buffering, and stream processing through async iterables.

### Key Features

- **Lightweight**: Less than 6KB (~2KB when gzipped)
- **Auto-Reconnect**: Exponential/linear backoff + jitter
- **Buffer Management**: Size limits and overflow policies
- **Async Iterable**: Generator-based message streams
- **Type Safety**: Full TypeScript support
- **Zero Dependencies**: Uses only native WebSocket API

---

## Core Design Principles

### 1. Class-Based Structure

We adopted a class-based structure to improve readability and maintainability.

**Why Classes?**

- **Clear Separation of Concerns**: Each class has a single responsibility
  - `EventHandler`: Event emission and queue management
  - `MessageHandler`: Message receiving/sending and buffering
  - `ConnectionHandler`: WebSocket connection/reconnection management
  - `Socket`: Combines handlers to implement Socket interface
- **Improved Readability**: Public methods at the top, private methods at the bottom
- **Maintainability**: Each class can be modified and tested independently
- **Type Safety**: Generic types are clearly passed

### 2. Event-Driven Architecture

All state changes are tracked as events to ensure transparency and ease of debugging.

### 3. Generator-Based Streams

Messages and events are processed as streams using async iterables.

---

## Module Structure

```
src/
├── index.ts          # Public API entry point
├── socket.ts         # Socket class + createSocket factory
├── handlers/         # Handler classes
│   ├── event-handler.ts      # EventHandler class
│   ├── message-handler.ts    # MessageHandler class
│   └── connection-handler.ts # ConnectionHandler class
├── generators.ts     # Async iterable generators
├── types.ts          # TypeScript type definitions
├── utils.ts          # Utility functions
└── constants.ts      # Constant definitions
```

### Module Responsibilities

#### `socket.ts`
- `createSocket()`: Factory function to create socket instance
- `Socket`: Combines handlers to implement Socket interface

#### `handlers/event-handler.ts`
- `EventHandler`: Event emission and queue management

#### `handlers/message-handler.ts`
- `MessageHandler`: Message receiving/sending and buffering

#### `handlers/connection-handler.ts`
- `ConnectionHandler`: WebSocket connection/reconnection management

#### `generators.ts`
- `messagesGenerator()`: Message stream generator
- `eventsGenerator()`: Event stream generator

#### `types.ts`
- All TypeScript type definitions
- Public API interfaces
- Internal state types

#### `utils.ts`
- `createEvent()`: Event object creation
- `calculateReconnectInterval()`: Reconnection interval calculation
- `normalizeOptions()`: Options normalization
- `createState()`: State object creation
- `parseMessage()`: Message parsing
- `serializeMessage()`: Message serialization
- `handleBufferOverflow()`: Buffer overflow handling
- `createDroppedEvent()`: Dropped event creation

#### `constants.ts`
- Hardcoded numeric values defined as constants
- `DEFAULT_RECONNECT_INTERVAL`, `MAX_RECENT_EVENTS`, etc.

---

## Class-Based Structure

### Class Hierarchy

```
createSocket()
    ↓
Socket<Incoming, Outgoing>
    ├── EventHandler<Incoming>
    ├── MessageHandler<Incoming, Outgoing>
    └── ConnectionHandler<Incoming, Outgoing>
```

### EventHandler Class

Handles event emission and queue management.

```typescript
class EventHandler<Incoming> {
  constructor(private state: InternalSocketState<Incoming>) {}
  
  emit(event: SocketEvent): void {
    // Call callbacks
    // Manage event queue
    // Notify iterators
  }
}
```

**Key Responsibilities:**
- Event callback invocation
- Event queue management (prevent memory leaks)
- Iterator notification (wake up resolvers)

### MessageHandler Class

Handles message receiving/sending and buffering.

```typescript
class MessageHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>
  ) {}
  
  // Public methods
  receive(data: string): void
  receiveMessages(messages: AsyncIterable<string>, options?): Promise<void>
  send(data: Outgoing): void
  sendMessages(messages: AsyncIterable<Outgoing>, options?): Promise<void>
  flushQueue(): void
  
  // Private methods
  private handleCallbacks(parsed: Incoming): void
  private bufferReceivedMessage(data: string): void
  private handleSendImmediately(message, data): void
  private queueSendMessage(messageStr: string): void
}
```

**Key Responsibilities:**
- Message receiving (parsing, callbacks, buffering)
- Message sending (serialization, immediate send or queue)
- Buffer overflow handling
- Queue flushing

**Method Separation:**
- `receive`: Split into `handleCallbacks` + `bufferReceivedMessage`
- `send`: Split into `handleSendImmediately` + `queueSendMessage`
- Consistent naming pattern: `handle*` (processing logic), `buffer*/queue*` (buffer/queue related)

### ConnectionHandler Class

Handles WebSocket connection/reconnection and lifecycle management.

```typescript
class ConnectionHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>,
    private messageHandler: MessageHandler<Incoming, Outgoing>
  ) {}
  
  scheduleReconnect(): void
  connect(): void
  close(code?: number, reason?: string): void
}
```

**Key Responsibilities:**
- WebSocket connection creation and management
- Reconnection scheduling
- Connection termination handling
- Event handler setup (onopen, onmessage, onerror, onclose)

### Socket Class

Combines handlers to implement Socket interface.

```typescript
class Socket<Incoming, Outgoing> implements SocketInterface<Incoming, Outgoing> {
  private eventHandler: EventHandler<Incoming>;
  private messageHandler: MessageHandler<Incoming, Outgoing>;
  private connectionHandler: ConnectionHandler<Incoming, Outgoing>;
  
  // Public API
  messages(options?): AsyncIterable<Incoming>
  events(options?): AsyncIterable<SocketEvent>
  onMessage(callback): () => void
  onEvent(callback): () => void
  connect(): void
  close(code?, reason?): void
  send(data: Outgoing): void
  sendMessages(messages, options?): Promise<void>
}
```

**Key Responsibilities:**
- Handler instance creation and composition
- Socket interface implementation
- Public API provision

**File Structure:**
- `socket.ts`: Socket class and createSocket factory function
- Each handler is in a separate file in the `handlers/` directory

### Code Structure Improvements

**Public Methods First:**
- Public methods at the top of the class for quick interface understanding
- `receive`, `send`, `receiveMessages`, `sendMessages`, `flushQueue`, etc.

**Private Methods Last:**
- Implementation details at the bottom of the class
- `handleCallbacks`, `bufferReceivedMessage`, `handleSendImmediately`, `queueSendMessage`, etc.

---

## State Management

### InternalSocketState

Manages all internal state of the socket.

```typescript
interface InternalSocketState<Incoming> {
  ws: WebSocket | null;                    // WebSocket instance
  isManualClose: boolean;                   // Manual close flag
  reconnectCount: number;                   // Reconnection attempt count
  reconnectTimer: ReturnType<typeof setTimeout> | null;  // Reconnection timer
  messageBuffer: string[];                  // Received message buffer
  eventQueue: SocketEvent[];                // Event queue
  messageQueue: string[];                   // Send message queue
  messageCallbacks: Set<(data: Incoming) => void>;  // Message callbacks
  eventCallbacks: Set<(event: SocketEvent) => void>;  // Event callbacks
  abortController: AbortController | null;  // Abort controller
  activeMessageIterators: number;          // Active message iterator count
  activeEventIterators: number;             // Active event iterator count
  messageResolvers: Set<() => void>;        // Message waiting resolvers
  eventResolvers: Set<() => void>;          // Event waiting resolvers
}
```

### State Access Pattern

All handler classes receive `state` and `opts` through constructors:

```typescript
class MessageHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>
  ) {}
  
  receive(data: string): void {
    // Direct access to state and opts
    const parsed = parseMessage<Incoming>(data);
    this.handleCallbacks(parsed);
    this.bufferReceivedMessage(data);
  }
}
```

---

## API Design: Callback vs Generator

purrcat supports both API styles. Understanding the advantages and disadvantages of each helps you choose the right one for your project.

### Callback-Based API

```typescript
const socket = createSocket({ url: 'wss://example.com' });

socket.onMessage((message) => {
  console.log('Received:', message);
});

socket.onEvent((event) => {
  console.log('Event:', event.type);
});
```

#### Advantages

1. **Immediate Execution**: Callback called immediately when message arrives, no delay
2. **Memory Efficient**: Direct processing without buffering (when no iterators)
3. **Simple Usage**: Simple and intuitive setup
4. **Event-Based**: Similar to traditional event listener pattern
5. **Multiple Handlers**: Can register multiple callbacks simultaneously
6. **Broadcast**: All registered callbacks receive the same message

#### Disadvantages

1. **Limited Control Flow**: Difficult to do sequential or conditional processing
2. **Complex Error Handling**: Each callback needs individual error handling
3. **Async Processing Difficulty**: Care needed when using async/await inside callbacks
4. **Difficult Cancellation**: Complex to stop message reception under specific conditions

#### Recommended Use Cases

- **Real-time Notifications**: When messages must be processed immediately upon arrival
- **Simple Logging/Monitoring**: When all messages are simply logged or forwarded
- **Event-Based Architecture**: To maintain consistency with existing event listener patterns
- **Multiple Subscribers**: When multiple handlers need to process messages simultaneously
- **Multiple Pages/Components**: When the same message needs to be received in multiple places

### Generator-Based API

```typescript
const socket = createSocket({ url: 'wss://example.com' });

// Message stream
for await (const message of socket.messages()) {
  console.log('Received:', message);
  // Easy conditional processing, cancellation, etc.
  if (shouldStop(message)) break;
}

// Event stream
for await (const event of socket.events({ signal: abortController.signal })) {
  console.log('Event:', event.type);
  // Can be cancelled with AbortSignal
}
```

#### Advantages

1. **Sequential Processing**: Can process messages one by one in order
2. **Control Flow**: Can use conditionals, loops, cancellation, etc. - normal control flow
3. **Error Handling**: Can use try-catch for unified error handling
4. **Cancellation Control**: Easy to stop with `break`, `return`, `AbortSignal`
5. **Async Processing**: Naturally integrates with async/await
6. **Stream Processing**: Good for backpressure handling
7. **Type Safety**: Well integrated with TypeScript

#### Disadvantages

1. **Memory Usage**: Buffering required when iterators are active
2. **Initial Delay**: Messages before iterator starts are stored in buffer
3. **Message Consumption Model**: Generators **consume** messages
   - When multiple iterators are active simultaneously, each iterator **independently** consumes messages
   - Multiple iterators cannot receive the same message (once one consumes it, others cannot receive it)
   - **Use callbacks when multiple pages/components need to receive the same message**
4. **Learning Curve**: Requires understanding of async iterables

#### Recommended Use Cases

- **Sequential Processing**: When messages need to be processed in order
- **Conditional Processing**: When message processing logic needs to change based on conditions
- **Error Recovery**: When retry or recovery logic is needed on errors
- **Stream Transformation**: Building pipelines to transform or filter messages
- **Cancellable Tasks**: When reception needs to be stopped on user action or specific conditions
- **Complex Business Logic**: When multiple stages of async processing are needed

### Hybrid Usage

Both APIs can be used simultaneously:

```typescript
const socket = createSocket({ url: 'wss://example.com' });

// Callback: Log all messages
socket.onMessage((msg) => console.log('Log:', msg));

// Generator: Process only specific messages
for await (const msg of socket.messages()) {
  if (msg.type === 'important') {
    await processImportantMessage(msg);
  }
}
```

### Performance Considerations

- **Callback Only**: Minimize memory usage, immediate processing
- **Generator Only**: Memory usage due to buffering, sequential processing possible
- **Hybrid**: Callbacks process immediately, generators consume from buffer

### Selection Guide

| Situation | Recommended API |
|-----------|----------------|
| Real-time notifications, simple logging | Callback |
| Sequential processing, conditional logic | Generator |
| Error recovery, retry logic | Generator |
| **Multiple subscriber pattern** | **Callback** |
| **Multiple pages/components receiving same message** | **Callback** |
| Stream transformation/filtering | Generator |
| User-cancellable tasks | Generator (AbortSignal) |
| Memory-constrained environments | Callback (generators disabled) |

### Receiving Same Events Across Multiple Pages

When **multiple pages or components need to receive the same message/event**, you **must use the callback-based API**.

#### ❌ Generators Are Not Suitable

```typescript
// Page A
for await (const msg of socket.messages()) {
  // Message is consumed - removed from buffer
  console.log('Page A:', msg);
}

// Page B
for await (const msg of socket.messages()) {
  // Cannot receive messages already consumed by Page A
  console.log('Page B:', msg); // May miss some messages
}
```

Generators **consume** messages, so when one iterator receives a message, it's removed from the buffer and other iterators cannot receive it.

#### ✅ Callbacks Are Suitable

```typescript
// Page A
socket.onMessage((msg) => {
  console.log('Page A:', msg);
  // Message is not consumed - other handlers can also receive it
});

// Page B
socket.onMessage((msg) => {
  console.log('Page B:', msg);
  // Can receive the same message
});

// Page C
socket.onMessage((msg) => {
  console.log('Page C:', msg);
  // All handlers receive the same message
});
```

Callbacks **do not consume** messages and **broadcast** to all registered handlers, so multiple subscribers can receive the same message.

#### Real-World Example

```typescript
// Global socket instance
const socket = createSocket({ url: 'wss://example.com' });

// Component A: Show notifications
socket.onMessage((msg) => {
  if (msg.type === 'notification') {
    showNotification(msg);
  }
});

// Component B: Logging
socket.onMessage((msg) => {
  logger.log('Message received:', msg);
});

// Component C: State update
socket.onMessage((msg) => {
  updateState(msg);
});

// All components receive the same message
```

---

## Event System

### Event Types

```typescript
type SocketEventType =
  | 'open'        // Connection opened
  | 'close'       // Connection closed
  | 'error'       // Error occurred
  | 'reconnect'    // Reconnection attempt
  | 'received'    // Message received
  | 'sent'        // Message sent
  | 'dropped';    // Message dropped
```

### Event Emission Flow

```
Event Occurs
    ↓
EventHandler.emit()
    ↓
    ├─→ eventCallbacks (immediate call)
    ├─→ eventQueue (add to queue)
    └─→ eventResolvers (wake waiting iterators)
```

### Event Processing Methods

1. **Callback Method**: Callbacks registered with `onEvent()` are called immediately
2. **Stream Method**: Consume event stream with `events()` generator
3. **Hybrid**: Both methods can be used simultaneously

---

## Generator-Based Streams

### Message Stream

```typescript
async function* messagesGenerator(state, signal) {
  state.activeMessageIterators++;
  
  try {
    while (true) {
      // Yield buffered messages
      while (state.messageBuffer.length > 0) {
        yield parseMessage(state.messageBuffer.shift());
      }
      
      // Wait for new messages
      await waitForItems(...);
    }
  } finally {
    state.activeMessageIterators--;
    // Clear buffer when last iterator ends
    if (state.activeMessageIterators === 0) {
      state.messageBuffer = [];
    }
  }
}
```

### Event-Based Waiting Mechanism

`waitForItems()` provides an efficient waiting mechanism:

1. **Immediate Check**: Returns immediately if items already exist
2. **Event-Based**: Registers resolver to get immediate notification when new items arrive
3. **Polling Fallback**: Polls at 100ms intervals only when AbortSignal is not available

### Iterator Lifecycle Management

- `activeMessageIterators`: Tracks number of active message iterators
- `activeEventIterators`: Tracks number of active event iterators
- Buffer/queue automatically cleared when last iterator ends (prevents memory leaks)

### Event Queue Memory Management

The event queue is optimized to prevent memory leaks while allowing iterators to receive events that occurred before they started:

- **When iterators are active**: All events are added to queue and notified immediately
- **When no iterators**: Only the most recent 10 events are kept (prevents memory leaks)
  - New iterators can receive recent events when they start
  - Prevents infinite growth even when only callbacks are used

---

## Reconnection Mechanism

### Reconnection Strategies

1. **Exponential Backoff**: `interval * 2^attempt`
2. **Linear Backoff**: `interval * (attempt + 1)`
3. **Jitter**: ±20% random variation (prevents thundering herd)

### Reconnection Flow

```
Connection Closed
    ↓
onclose event
    ↓
Not manual close and reconnection enabled?
    ↓
ConnectionHandler.scheduleReconnect()
    ↓
Calculate interval (backoff + jitter)
    ↓
Set timer
    ↓
Reconnection attempt
    ↓
ConnectionHandler.connect()
```

### Reconnection Limits

- `attempts`: Maximum reconnection attempts (default: Infinity)
- `maxInterval`: Maximum reconnection interval (default: 30000ms)

---

## Buffer Management

### Receive Buffer (messageBuffer)

Message buffering on receive:

- **Condition**: Buffering only when `activeMessageIterators > 0`
- **Size Limit**: `opts.buffer.receive.size` (default: 100)
- **Overflow Policy**:
  - `oldest`: Remove oldest message
  - `newest`: Drop new message
  - `error`: Throw error

### Send Queue (messageQueue)

Message queuing when connection is closed:

- **Size Limit**: `opts.buffer.send.size` (default: 100)
- **Overflow Policy**: Same as receive buffer
- **Auto Flush**: Automatically sends queued messages when connection succeeds

### Buffer Lifecycle

- **Message Buffer**: 
  - Buffering only when iterators are active
  - Cleared when last message iterator ends
- **Event Queue**: 
  - When iterators are active: All events added to queue
  - When no iterators: Only most recent 10 kept (prevents memory leaks)
  - Cleared when last event iterator ends
- **Message Queue**: Cleared on connection close

---

## Data Flow

### Message Receive Flow

```
WebSocket.onmessage
    ↓
ConnectionHandler.connect() → onmessage handler
    ↓
MessageHandler.receive(data)
    ↓
    ├─→ Try JSON parsing
    ├─→ EventHandler.emit('received')
    ├─→ handleCallbacks() → messageCallbacks call
    └─→ bufferReceivedMessage() → add to messageBuffer (only when iterators exist)
            ↓
        Wake messageResolvers
            ↓
        yield in messagesGenerator
```

### Message Send Flow

```
send(data)
    ↓
MessageHandler.send()
    ↓
Check connection state
    ├─→ OPEN: handleSendImmediately()
    │       ↓
    │   EventHandler.emit('sent')
    │
    └─→ Closed: queueSendMessage()
            ↓
        Buffer overflow check
            ↓
        Handle according to overflow policy
```

### Event Flow

```
State Change Occurs
    ↓
EventHandler.emit(event)
    ↓
    ├─→ eventCallbacks immediate call
    ├─→ Add to eventQueue
    └─→ Wake eventResolvers
            ↓
        yield in eventsGenerator
```

---

## Design Decisions

### Why Classes?

1. **Improved Readability**: Public methods at top for quick interface understanding
2. **Clear Separation of Concerns**: Each class has a single responsibility
3. **Maintainability**: Each class can be modified and tested independently
4. **Type Safety**: Generic types are clearly passed
5. **Code Structure**: Public/Private method separation clarifies structure

### Method Separation Strategy

**receive Method Separation:**
- `handleCallbacks`: Callback invocation logic
- `bufferReceivedMessage`: Buffering logic
- `receive`: Combines the above two methods

**send Method Separation:**
- `handleSendImmediately`: Immediate send logic
- `queueSendMessage`: Queuing logic
- `send`: Combines the above two methods

**Consistent Naming Pattern:**
- `handle*`: Processing logic (handleCallbacks, handleSendImmediately)
- `buffer*/queue*`: Buffer/queue related (bufferReceivedMessage, queueSendMessage)

### Why Not Pure Functions?

1. **State Changes Required**: WebSocket connections, timers, buffer manipulation, etc.
2. **Side Effects**: Event emission, network communication are core features
3. **Practicality**: Making it pure functions would make the code overly complex

---

## Extensibility Considerations

### Current Structure Advantages

- **Modularity**: Each class has clear responsibilities
- **Type Safety**: Complete type checking with TypeScript
- **Testability**: Each class can be tested independently
- **Readability**: Public/Private method separation clarifies structure

### Future Improvement Areas

- **Plugin System**: Extend reconnection strategies, buffer policies as plugins
- **Logging System**: Integrate event-based logging system
- **Metrics Collection**: Collect connection status, message throughput, etc.

---

## Performance Considerations

### Memory Management

- **Message Buffer**: Buffering only when iterators are active (prevents memory leaks)
- **Event Queue**: 
  - When iterators are active: All events added to queue
  - When no iterators: Only most recent 10 kept (prevents infinite growth)
  - When iterators end: Queue automatically cleared
- **Callback Management**: Efficient callback add/remove using Set
- **Resource Cleanup**: All resources (timers, queues, etc.) cleaned up on connection close

### Network Efficiency

- Message queuing until connection opens
- Memory usage control through buffer overflow policies
- Server load distribution through jitter on reconnection

---

## Conclusion

purrcat's architecture is centered around **class-based structure**, **event-driven design**, and **generator-based streams**. We adopted a class-based structure to improve readability and maintainability, with each class designed to have clear responsibilities. We clarified the code structure by placing public methods at the top and private methods at the bottom, and significantly improved code readability through method separation and consistent naming patterns.

Additionally, we designed the library to **support both callback and generator APIs** to handle diverse use cases. Callbacks are suitable for multiple subscriber patterns and broadcasting, while generators are suitable for sequential processing and complex control flow. Developers can choose the appropriate API based on their project requirements.
