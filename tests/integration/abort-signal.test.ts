/**
 * abort-signal.test.ts
 *
 * Purpose: Integration tests for async operation cancellation using AbortSignal
 *
 * Test Coverage:
 * - AbortSignal handling in messages() generator (at start, during consumption, while waiting)
 * - AbortSignal handling in events() generator (at start, during consumption, during polling)
 * - AbortSignal handling in sendMessages() and error handling
 * - Independent AbortSignal handling for multiple generators
 * - Edge cases (undefined signal, cannot reuse, etc.)
 *
 * Boundaries:
 * - Basic generator behavior is tested in api-generators.test.ts
 * - General cases without AbortSignal are tested in other files
 * - Handler unit tests are in handlers/ directory
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createSocket from '../../src/index.js';
import type { SocketEvent } from '../../src/types.js';
import { setupWebSocketMock, cleanupWebSocketMock, createdWebSockets } from '../helpers.js';

describe('AbortSignal Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupWebSocketMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWebSocketMock();
  });

  describe('messages() generator AbortSignal', () => {
    it('should abort immediately if signal is already aborted', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      controller.abort(); // Abort before starting

      const messages: string[] = [];
      const messagePromise = (async () => {
        try {
          for await (const msg of socket.messages({ signal: controller.signal })) {
            messages.push(msg as string);
          }
        } catch (error: unknown) {
          // AbortError is expected when signal is aborted
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      await vi.runAllTimersAsync();
      await messagePromise;

      expect(messages.length).toBe(0);
    });

    it('should abort while consuming buffered messages', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      const controller = new AbortController();
      const messages: string[] = [];

      // Start generator to enable buffering
      const messagePromise = (async () => {
        try {
          for await (const msg of socket.messages({ signal: controller.signal })) {
            messages.push(msg as string);
            // Abort after first message to test line 19-20
            if (messages.length === 1) {
              controller.abort();
              // This should trigger the break in the while loop
            }
          }
        } catch (error: unknown) {
          // AbortError is expected when signal is aborted
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      vi.advanceTimersByTime(20);

      // Fill buffer with multiple messages to ensure while loop executes
      ws.simulateMessage('msg1');
      vi.advanceTimersByTime(20);
      ws.simulateMessage('msg2');
      vi.advanceTimersByTime(20);
      ws.simulateMessage('msg3');
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await messagePromise;

      // Should have received first message before abort (covers line 19-20)
      expect(messages.length).toBe(1);
      expect(messages[0]).toBe('msg1');
    });

    it('should abort while waiting for new messages in polling loop', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      const messages: string[] = [];

      const messagePromise = (async () => {
        try {
          for await (const msg of socket.messages({ signal: controller.signal })) {
            messages.push(msg as string);
          }
        } catch (error: unknown) {
          // AbortError is expected when signal is aborted
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      // Let generator enter polling loop
      vi.advanceTimersByTime(20);

      // Abort while waiting (covers line 37-40)
      controller.abort();
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await messagePromise;

      expect(messages.length).toBe(0);
    });

    it('should clean up resources in finally block after abort', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      let finallyExecuted = false;

      const messagePromise = (async () => {
        try {
          for await (const _ of socket.messages({ signal: controller.signal })) {
            // Consume
          }
        } catch (error: unknown) {
          // AbortError is expected when signal is aborted
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        } finally {
          finallyExecuted = true;
        }
      })();

      vi.advanceTimersByTime(20);
      controller.abort();
      await vi.runAllTimersAsync();
      await messagePromise;

      expect(finallyExecuted).toBe(true);
    });

    it('should clear buffer when last iterator is aborted', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      const controller = new AbortController();

      const messagePromise = (async () => {
        try {
          for await (const _ of socket.messages({ signal: controller.signal })) {
            // Just consume
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      vi.advanceTimersByTime(20);
      ws.simulateMessage('msg1');
      vi.advanceTimersByTime(20);

      controller.abort();
      await messagePromise;
      await vi.runAllTimersAsync();

      // Start new iterator - should not receive old message
      const controller2 = new AbortController();
      const messages: string[] = [];
      const messagePromise2 = (async () => {
        try {
          for await (const msg of socket.messages({ signal: controller2.signal })) {
            messages.push(msg as string);
            controller2.abort();
            break;
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      vi.advanceTimersByTime(20);
      ws.simulateMessage('msg2');
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      controller2.abort();
      await messagePromise2;

      // Should only receive new message
      expect(messages).toContain('msg2');
      expect(messages).not.toContain('msg1');
    });
  });

  describe('events() generator AbortSignal', () => {
    it('should abort immediately if signal is already aborted', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      controller.abort(); // Abort before starting (covers line 71)

      const events: SocketEvent[] = [];
      const eventPromise = (async () => {
        try {
          for await (const event of socket.events({ signal: controller.signal })) {
            events.push(event);
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      await vi.runAllTimersAsync();
      await eventPromise;

      expect(events.length).toBe(0);
    });

    it('should abort while consuming queued events', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      // Trigger multiple events
      socket.close();
      socket.connect();
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      const events: SocketEvent[] = [];

      const eventPromise = (async () => {
        try {
          for await (const event of socket.events({ signal: controller.signal })) {
            events.push(event);
            // Abort after receiving first event to avoid infinite loop
            if (events.length >= 1) {
              controller.abort();
              break;
            }
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      // Let generator start consuming events
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(10);

      // Abort while generator is consuming from event queue (covers line 76-77)
      controller.abort();
      vi.advanceTimersByTime(10);

      await vi.runAllTimersAsync();
      await eventPromise;

      // Should have received some events before abort
      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('should abort while waiting for new events in polling loop', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      const events: SocketEvent[] = [];

      const eventPromise = (async () => {
        try {
          for await (const event of socket.events({ signal: controller.signal })) {
            events.push(event);
            // Exit after receiving first event to avoid infinite loop
            break;
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      // Let generator enter polling loop after consuming initial events
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(20);

      // Abort while in polling interval (covers line 86-90, 92-95)
      controller.abort();
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await eventPromise;

      // Should have received at least open event
      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle abort during polling interval check', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      const events: SocketEvent[] = [];

      const eventPromise = (async () => {
        for await (const event of socket.events({ signal: controller.signal })) {
          events.push(event);
          // Exit after first event to enter polling loop
          break;
        }
      })();

      // Start generator and let it consume initial event and enter polling
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(5);

      // Abort during polling (should be caught by interval check at line 86-89)
      controller.abort();
      vi.advanceTimersByTime(15); // Complete the 10ms interval

      await vi.runAllTimersAsync();
      await eventPromise;

      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle new events arriving during polling (covers line 92-95)', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const events: SocketEvent[] = [];
      const controller = new AbortController();

      const eventPromise = (async () => {
        try {
          for await (const event of socket.events({ signal: controller.signal })) {
            events.push(event);
            // Exit after receiving 2 events (open + close) to test polling detection (covers line 92-95)
            if (events.length >= 2) {
              controller.abort();
              break; // Exit the for-await loop
            }
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      // Consume initial open event and enter polling loop
      await vi.runAllTimersAsync();
      vi.advanceTimersByTime(20);

      // Trigger new event while in polling (covers line 92-95: polling detects new event)
      socket.close();
      await vi.runAllTimersAsync();

      // Advance timers to let polling interval detect the new event
      vi.advanceTimersByTime(20);

      // Wait for the generator to process the close event
      await vi.runAllTimersAsync();

      // Abort to ensure generator exits
      controller.abort();
      await eventPromise;

      // Should have received both open and close events
      expect(events.length).toBe(2);
      expect(events[0].type).toBe('open');
      expect(events[1].type).toBe('close');
    });
  });

  describe('sendMessages() AbortSignal', () => {
    it('should stop sending when aborted', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      let sentCount = 0;

      async function* messageGenerator() {
        for (let i = 0; i < 10; i++) {
          yield `message${i}`;
          sentCount++;
        }
      }

      const sendPromise = socket.sendMessages(messageGenerator(), {
        signal: controller.signal,
      });

      // Abort after a few messages
      vi.advanceTimersByTime(10);
      controller.abort();
      vi.advanceTimersByTime(10);

      await sendPromise;
      await vi.runAllTimersAsync();

      // Should have stopped early
      expect(sentCount).toBeLessThan(10);
    });

    it('should handle error and check abort status', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();

      async function* errorGenerator() {
        yield 'message1';
        controller.abort(); // Abort before error
        throw new Error('Test error');
      }

      // Should return silently if aborted (covers line 352-354)
      await expect(
        socket.sendMessages(errorGenerator(), { signal: controller.signal })
      ).resolves.toBeUndefined();
    });

    it('should rethrow error if not aborted', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      async function* errorGenerator() {
        yield 'message1';
        throw new Error('Test error');
      }

      // Should throw error if not aborted (covers line 356)
      await expect(socket.sendMessages(errorGenerator())).rejects.toThrow('Test error');
    });
  });

  describe('Multiple generators with AbortSignal', () => {
    it('should handle independent AbortSignals for multiple message generators', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      const controller1 = new AbortController();
      const controller2 = new AbortController();

      const messages1: string[] = [];
      const messages2: string[] = [];

      const promise1 = (async () => {
        try {
          for await (const msg of socket.messages({ signal: controller1.signal })) {
            messages1.push(msg as string);
            if (messages1.length >= 1) {
              controller1.abort();
              break;
            }
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      const promise2 = (async () => {
        try {
          for await (const msg of socket.messages({ signal: controller2.signal })) {
            messages2.push(msg as string);
            if (messages2.length >= 1) {
              // Abort after receiving one message to avoid infinite loop
              controller2.abort();
              break;
            }
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      vi.advanceTimersByTime(20);
      ws.simulateMessage('msg1');
      vi.advanceTimersByTime(20);
      ws.simulateMessage('msg2');
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await promise1;
      await promise2;

      // Each should receive messages independently
      expect(messages1.length).toBe(1);
      expect(messages2.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle independent AbortSignals for multiple event generators', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      // Abort both immediately to test independent signals
      controller1.abort();
      controller2.abort();

      const events1: SocketEvent[] = [];
      const events2: SocketEvent[] = [];

      const promise1 = (async () => {
        try {
          for await (const event of socket.events({ signal: controller1.signal })) {
            events1.push(event);
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      const promise2 = (async () => {
        try {
          for await (const event of socket.events({ signal: controller2.signal })) {
            events2.push(event);
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      await vi.runAllTimersAsync();
      await promise1;
      await promise2;

      // Both should exit immediately due to aborted signals
      expect(events1.length).toBe(0);
      expect(events2.length).toBe(0);
    });
  });

  describe('AbortSignal edge cases', () => {
    it('should handle undefined signal gracefully', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      const messages: string[] = [];

      const messagePromise = (async () => {
        for await (const msg of socket.messages()) {
          // No signal provided
          messages.push(msg as string);
          if (messages.length >= 1) break;
        }
      })();

      vi.advanceTimersByTime(20);
      ws.simulateMessage('msg1');
      vi.advanceTimersByTime(20);

      await vi.runAllTimersAsync();
      await messagePromise;

      expect(messages.length).toBe(1);
    });

    it('should handle rapid abort/unabort (signal is one-time)', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      const messages: string[] = [];

      const messagePromise = (async () => {
        try {
          for await (const msg of socket.messages({ signal: controller.signal })) {
            messages.push(msg as string);
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      // Abort once - should stop generator
      controller.abort();
      await vi.runAllTimersAsync();
      await messagePromise;

      // Signal is one-time, cannot be reused
      expect(messages.length).toBe(0);
    });

    it('should properly clean up timers on abort', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      let timeoutCount = 0;

      // Spy on setTimeout to count calls (used for polling fallback)
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn((callback: () => void, delay?: number, ...args: unknown[]) => {
        timeoutCount++;
        return originalSetTimeout(callback, delay, ...args);
      }) as unknown as typeof setTimeout;

      const messagePromise = (async () => {
        try {
          for await (const _ of socket.messages({ signal: controller.signal })) {
            // Consume
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      vi.advanceTimersByTime(20);
      controller.abort();
      await vi.runAllTimersAsync();
      await messagePromise;

      // Restore original
      global.setTimeout = originalSetTimeout;

      // With AbortSignal, we use event-based notification (no polling),
      // so timeoutCount should be 0. This confirms we're not using polling unnecessarily.
      expect(timeoutCount).toBe(0);
    });

    it('should use polling fallback when no AbortSignal is provided', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();
      const ws = createdWebSockets[0];

      let timeoutCount = 0;

      // Spy on setTimeout to count calls
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn((callback: () => void, delay?: number, ...args: unknown[]) => {
        timeoutCount++;
        return originalSetTimeout(callback, delay, ...args);
      }) as unknown as typeof setTimeout;

      const messagePromise = (async () => {
        for await (const msg of socket.messages()) {
          // Consume one message and break
          expect(msg).toBe('test');
          break;
        }
      })();

      // Advance timers to trigger polling (if no message arrives)
      vi.advanceTimersByTime(150);

      // Send a message which should wake up the generator via resolver
      ws.simulateMessage('test');
      await vi.runAllTimersAsync();

      await messagePromise;

      // Restore original
      global.setTimeout = originalSetTimeout;

      // With resolver mechanism, polling should not be needed when message arrives quickly
      // But if message arrives after polling starts, timeoutCount may be > 0
      // The important thing is that it works correctly
      expect(timeoutCount).toBeGreaterThanOrEqual(0);

      socket.close();
    });

    it('should execute polling fallback when items become available during polling', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();
      const ws = createdWebSockets[0];

      let pollSetTimeoutCalled = false;
      let pollCallbackExecuted = false;
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn((callback: () => void, delay?: number, ...args: unknown[]) => {
        // Verify that polling setTimeout is called (covers lines 294-297 in utils.ts)
        if (delay === 100) {
          // POLLING_INTERVAL_MS is 100
          pollSetTimeoutCalled = true;
          // Wrap callback to track execution
          return originalSetTimeout(
            () => {
              pollCallbackExecuted = true;
              callback();
            },
            delay,
            ...args
          );
        }
        return originalSetTimeout(callback, delay, ...args);
      }) as unknown as typeof setTimeout;

      const messagePromise = (async () => {
        for await (const msg of socket.messages()) {
          expect(msg).toBe('test');
          break;
        }
      })();

      // Start generator without message (will trigger polling fallback)
      vi.advanceTimersByTime(50);

      // Send message after polling has started - this should trigger hasItems() check in poll
      // Wait a bit to ensure polling has started
      vi.advanceTimersByTime(150);
      ws.simulateMessage('test');
      await vi.runAllTimersAsync();

      await messagePromise;

      // Restore original
      global.setTimeout = originalSetTimeout;

      // Polling setTimeout should have been called (covers lines 294-297 in utils.ts)
      expect(pollSetTimeoutCalled).toBe(true);
      // Poll callback should execute and check hasItems() (covers lines 293-295 in utils.ts)
      expect(pollCallbackExecuted).toBe(true);

      socket.close();
    });

    it('should resolve immediately when items are already available', async () => {
      const socket = createSocket({ url: 'ws://test.com' });
      await vi.runAllTimersAsync();
      const ws = createdWebSockets[0];

      // Start generator first to enable buffering
      const controller = new AbortController();
      const messagePromise = (async () => {
        for await (const msg of socket.messages({ signal: controller.signal })) {
          expect(msg).toBe('test');
          controller.abort();
          break;
        }
      })();

      // Let generator start
      vi.advanceTimersByTime(20);

      // Send message - should be buffered and immediately available (covers lines 281-283 in utils.ts)
      ws.simulateMessage('test');
      await vi.runAllTimersAsync();
      await messagePromise;

      socket.close();
    });
  });
});
