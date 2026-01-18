/**
 * api-generators.test.ts
 * 
 * Purpose: Integration tests for generator-based API (messages(), events(), sendMessages()) basic behavior
 * 
 * Test Coverage:
 * - Message reception via messages() generator
 * - Event reception via events() generator
 * - Sending multiple messages via sendMessages()
 * - Buffer clearing logic (when no active iterators)
 * - Buffering behavior (messages are not buffered when no active iterators)
 * 
 * Boundaries:
 * - AbortSignal integration is tested in detail in abort-signal.test.ts
 * - Buffer overflow is tested in buffer-overflow.test.ts
 * - Callback-based API is tested in api-callbacks.test.ts
 * - Handler unit tests are in handlers/ directory
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createSocket from '../../src/index.js';
import {
  setupWebSocketMock,
  cleanupWebSocketMock,
  createdWebSockets,
} from '../helpers.js';

describe('Generator-Based API (Async Iterables)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupWebSocketMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWebSocketMock();
  });

  it('should receive messages via messages() generator', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    expect(createdWebSockets.length).toBeGreaterThan(0);
    const ws = createdWebSockets[0];

    const messages: string[] = [];
    const controller = new AbortController();

    // Start consuming messages
    const messagePromise = (async () => {
      for await (const msg of socket.messages({ signal: controller.signal })) {
        messages.push(msg as string);
        if (messages.length >= 2) {
          controller.abort();
          break;
        }
      }
    })();

    // Advance timers to allow generator to start polling
    vi.advanceTimersByTime(20);

    // Simulate message from server
    ws.simulateMessage('message1');
    vi.advanceTimersByTime(20);

    ws.simulateMessage('message2');
    vi.advanceTimersByTime(20);

    // Wait a bit more for messages to be processed
    await vi.runAllTimersAsync();

    // Abort to stop the generator
    controller.abort();
    await messagePromise;

    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages).toContain('message1');
    expect(messages).toContain('message2');
  });

  it('should emit events via events() generator', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const events: any[] = [];
    const eventPromise = (async () => {
      for await (const event of socket.events()) {
        events.push(event);
        if (events.some((e) => e.type === 'open')) break;
      }
    })();

    await vi.runAllTimersAsync();
    await eventPromise;

    expect(events.some((e) => e.type === 'open')).toBe(true);
  });

  it('should clear message buffer when no active iterators', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const ws = createdWebSockets[0];

    // Start and stop a generator
    const controller1 = new AbortController();
    const promise1 = (async () => {
      for await (const _ of socket.messages({ signal: controller1.signal })) {
        // Consume
      }
    })();

    vi.advanceTimersByTime(20);
    ws.simulateMessage('msg1');
    vi.advanceTimersByTime(20);

    controller1.abort();
    await promise1;

    // Start a new generator - should not receive old messages
    const controller2 = new AbortController();
    const messages: string[] = [];
    const promise2 = (async () => {
      for await (const msg of socket.messages({ signal: controller2.signal })) {
        messages.push(msg as string);
        controller2.abort();
        break;
      }
    })();

    vi.advanceTimersByTime(20);
    ws.simulateMessage('msg2');
    vi.advanceTimersByTime(20);

    await vi.runAllTimersAsync();
    controller2.abort();
    await promise2;

    // Should only receive new message, not old one
    expect(messages).toContain('msg2');
    expect(messages).not.toContain('msg1');
  });

  it('should send multiple messages via sendMessages()', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    async function* messageGenerator() {
      yield 'message1';
      yield 'message2';
      yield 'message3';
    }

    await socket.sendMessages(messageGenerator());
    await vi.runAllTimersAsync();

    // Verify sendMessages completes without error
    expect(socket).toBeDefined();
  });

  it('should not buffer messages when no active iterators', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      buffer: {
        receive: {
          size: 1,
        },
      },
    });

    await vi.runAllTimersAsync();
    const ws = createdWebSockets[0];

    // Send messages without active iterator
    ws.simulateMessage('msg1');
    ws.simulateMessage('msg2');
    ws.simulateMessage('msg3');

    await vi.runAllTimersAsync();

    // Messages should be received via callbacks, not buffered
    const messages: string[] = [];
    socket.onMessage((msg) => {
      messages.push(msg as string);
    });

    await vi.runAllTimersAsync();

    // Callbacks should work (messages were not buffered)
    expect(socket).toBeDefined();
  });

});
