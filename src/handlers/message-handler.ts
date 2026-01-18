import type {
  InternalSocketState,
  NormalizedSocketOptions,
} from '../types.js';
import {
  parseMessage,
  serializeMessage,
  handleBufferOverflow,
  createEvent,
  createDroppedEvent,
} from '../utils.js';
import { EventHandler } from './event-handler.js';

/**
 * Handles message receiving, sending, and buffering
 */
export class MessageHandler<Incoming, Outgoing> {
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
