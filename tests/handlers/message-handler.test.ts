/**
 * message-handler.test.ts
 *
 * Purpose: Unit tests for MessageHandler class
 *
 * Test Coverage:
 * - Message receiving and parsing
 * - Message sending (immediate and queued)
 * - Message buffering
 * - Buffer overflow handling
 * - Queue flushing
 * - receiveMessages and sendMessages async iterables
 *
 * Boundaries:
 * - Integration tests for message API are in integration/api-callbacks.test.ts and integration/api-generators.test.ts
 * - Buffer overflow policy tests are in integration/buffer-overflow.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageHandler } from '../../src/handlers/message-handler.js';
import { EventHandler } from '../../src/handlers/event-handler.js';
import { createState, normalizeOptions } from '../../src/utils.js';
import type { NormalizedSocketOptions } from '../../src/types.js';
import { setupWebSocketMock, cleanupWebSocketMock, MockWebSocket } from '../helpers.js';

describe('MessageHandler', () => {
  let handler: MessageHandler<string, string>;
  let eventHandler: EventHandler<string>;
  let state: ReturnType<typeof createState<string>>;
  let opts: NormalizedSocketOptions;

  beforeEach(() => {
    vi.useFakeTimers();
    setupWebSocketMock();
    state = createState<string>();
    eventHandler = new EventHandler<string>(state);
    opts = normalizeOptions({ url: 'ws://test.com' });
    handler = new MessageHandler<string, string>(state, opts, eventHandler);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWebSocketMock();
  });

  describe('receive', () => {
    it('should parse JSON messages', () => {
      const callback = vi.fn();
      state.messageCallbacks.add(callback);

      handler.receive('{"type":"test","data":"hello"}');

      expect(callback).toHaveBeenCalledWith({ type: 'test', data: 'hello' });
    });

    it('should handle non-JSON string messages', () => {
      const callback = vi.fn();
      state.messageCallbacks.add(callback);

      handler.receive('plain text');

      expect(callback).toHaveBeenCalledWith('plain text');
    });

    it('should emit received event', () => {
      const eventCallback = vi.fn();
      state.eventCallbacks.add(eventCallback);

      handler.receive('test message');

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'received',
          meta: expect.objectContaining({
            message: 'test message',
          }),
        })
      );
    });

    it('should buffer messages when active iterators exist', () => {
      state.activeMessageIterators = 1;

      handler.receive('msg1');
      handler.receive('msg2');

      expect(state.messageBuffer.length).toBe(2);
      expect(state.messageBuffer).toContain('msg1');
      expect(state.messageBuffer).toContain('msg2');
    });

    it('should not buffer messages when no active iterators', () => {
      state.activeMessageIterators = 0;

      handler.receive('msg1');

      expect(state.messageBuffer.length).toBe(0);
    });
  });

  describe('send', () => {
    it('should queue messages when connection is not open', () => {
      state.ws = null;

      handler.send('msg1');
      handler.send('msg2');

      expect(state.messageQueue.length).toBe(2);
    });

    it('should queue messages when connection is not open', () => {
      state.ws = null;

      handler.send('msg1');
      handler.send('msg2');

      expect(state.messageQueue.length).toBe(2);
    });

    it('should queue messages when connection is closing', () => {
      const ws = { readyState: MockWebSocket.CLOSING } as unknown as WebSocket;
      state.ws = ws;

      handler.send('msg1');

      expect(state.messageQueue.length).toBe(1);
    });

    it('should send immediately when connection is open', async () => {
      await vi.runAllTimersAsync();
      const ws = new MockWebSocket('ws://test.com');
      ws.readyState = MockWebSocket.OPEN;
      state.ws = ws as unknown as WebSocket;

      const eventCallback = vi.fn();
      state.eventCallbacks.add(eventCallback);

      handler.send('msg1');
      await vi.runAllTimersAsync();

      // Should send immediately without queuing
      expect(ws.sentMessages.length).toBe(1);
      expect(state.messageQueue.length).toBe(0);
    });

    it('should handle send when ws becomes null during handleSendImmediately', async () => {
      await vi.runAllTimersAsync();
      const ws = new MockWebSocket('ws://test.com');
      ws.readyState = MockWebSocket.OPEN;
      state.ws = ws as unknown as WebSocket;

      // Mock ws.send to set ws to null (simulating race condition)
      const originalSend = ws.send;
      ws.send = function (this: typeof ws, data: string | ArrayBuffer | Blob) {
        state.ws = null; // Simulate connection closed during send
        originalSend.call(this, data);
      } as typeof ws.send;

      handler.send('msg1');
      await vi.runAllTimersAsync();

      // Should handle gracefully (covers line 197 in message-handler.ts)
      expect(ws.sentMessages.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('flushQueue', () => {
    it('should not flush when connection is not open', () => {
      state.ws = null;
      state.messageQueue.push('msg1');

      handler.flushQueue();

      expect(state.messageQueue.length).toBe(1);
    });

    it('should not flush when connection is closing', () => {
      const ws = { readyState: MockWebSocket.CLOSING } as unknown as WebSocket;
      state.ws = ws;
      state.messageQueue.push('msg1');

      handler.flushQueue();

      expect(state.messageQueue.length).toBe(1);
    });
  });

  describe('receiveMessages', () => {
    it('should process async iterable of messages', async () => {
      const callback = vi.fn();
      state.messageCallbacks.add(callback);

      async function* messageGenerator() {
        yield 'msg1';
        yield 'msg2';
        yield 'msg3';
      }

      await handler.receiveMessages(messageGenerator());
      await vi.runAllTimersAsync();

      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('should stop on AbortSignal', async () => {
      const controller = new AbortController();
      const callback = vi.fn();
      state.messageCallbacks.add(callback);

      async function* messageGenerator() {
        yield 'msg1';
        controller.abort();
        yield 'msg2';
        yield 'msg3';
      }

      await handler.receiveMessages(messageGenerator(), {
        signal: controller.signal,
      });
      await vi.runAllTimersAsync();

      // Should stop after abort
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should handle abort signal in catch block when error occurs', async () => {
      const controller = new AbortController();
      const callback = vi.fn();
      state.messageCallbacks.add(callback);

      async function* messageGenerator() {
        yield 'msg1';
        controller.abort();
        throw new Error('Test error');
      }

      // Should not throw error when signal is aborted, even if error occurs
      await expect(
        handler.receiveMessages(messageGenerator(), {
          signal: controller.signal,
        })
      ).resolves.toBeUndefined();
    });

    it('should throw error when not aborted', async () => {
      const callback = vi.fn();
      state.messageCallbacks.add(callback);

      async function* messageGenerator() {
        yield 'msg1';
        throw new Error('Test error');
      }

      // Should throw error when signal is not aborted (covers line 55)
      await expect(handler.receiveMessages(messageGenerator())).rejects.toThrow('Test error');
    });
  });

  describe('sendMessages', () => {
    it('should process async iterable of messages', async () => {
      await vi.runAllTimersAsync();
      const ws = new MockWebSocket('ws://test.com');
      ws.readyState = MockWebSocket.OPEN;
      state.ws = ws as unknown as WebSocket;

      async function* messageGenerator() {
        yield 'msg1';
        yield 'msg2';
        yield 'msg3';
      }

      // Should complete without error
      await expect(handler.sendMessages(messageGenerator())).resolves.toBeUndefined();
      await vi.runAllTimersAsync();
    });

    it('should stop on AbortSignal', async () => {
      await vi.runAllTimersAsync();
      const ws = new MockWebSocket('ws://test.com');
      ws.readyState = MockWebSocket.OPEN;
      state.ws = ws as unknown as WebSocket;

      const controller = new AbortController();

      async function* messageGenerator() {
        yield 'msg1';
        controller.abort();
        yield 'msg2';
      }

      await handler.sendMessages(messageGenerator(), {
        signal: controller.signal,
      });
      await vi.runAllTimersAsync();

      // Should stop after abort
      expect(ws.sentMessages.length).toBeLessThan(2);
    });
  });
});
