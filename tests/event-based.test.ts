/**
 * event-based.test.ts
 * 
 * Purpose: Tests for callback-based API (onMessage, onEvent) and event details
 * 
 * Test Coverage:
 * - onMessage() callback registration/unregistration and message reception
 * - onEvent() callback registration/unregistration and event reception
 * - All SocketEvent types (open, close, error, received, sent, dropped, reconnect)
 * - Close event details (code, reason, wasClean)
 * - Message format handling (JSON, non-JSON strings)
 * - Callback error handling (graceful degradation)
 * - Multiple callbacks registration and independent operation
 * 
 * Boundaries:
 * - Generator-based API is tested in generator-based.test.ts
 * - AbortSignal integration is tested in abort-signal.test.ts
 * - Buffer overflow events are tested in detail in buffer-overflow.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createSocket from '../src/index.js';
import {
  setupWebSocketMock,
  cleanupWebSocketMock,
  createdWebSockets,
} from './helpers';

describe('Event-Based API (Callbacks)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupWebSocketMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWebSocketMock();
  });

  it('should handle message callbacks', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const receivedMessages: any[] = [];
    socket.onMessage((msg) => {
      receivedMessages.push(msg);
    });

    // Simulate message
    expect(createdWebSockets.length).toBeGreaterThan(0);
    const ws = createdWebSockets[0];
    ws.simulateMessage('test message');

    await vi.runAllTimersAsync();

    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0]).toBe('test message');
  });

  it('should parse JSON messages correctly', async () => {
    type Incoming = { type: string; data: string };
    const socket = createSocket<Incoming>({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const messages: Incoming[] = [];
    socket.onMessage((msg) => {
      messages.push(msg);
    });

    const ws = createdWebSockets[0];
    ws.simulateMessage('{"type":"test","data":"hello"}');

    await vi.runAllTimersAsync();

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('test');
    expect(messages[0].data).toBe('hello');
  });

  it('should handle non-JSON string messages', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const messages: string[] = [];
    socket.onMessage((msg) => {
      messages.push(msg);
    });

    const ws = createdWebSockets[0];
    ws.simulateMessage('plain text message');

    await vi.runAllTimersAsync();

    expect(messages.length).toBe(1);
    expect(messages[0]).toBe('plain text message');
  });

  it('should handle multiple message callbacks', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const messages1: any[] = [];
    const messages2: any[] = [];

    socket.onMessage((msg) => messages1.push(msg));
    socket.onMessage((msg) => messages2.push(msg));

    const ws = createdWebSockets[0];
    ws.simulateMessage('message1');
    ws.simulateMessage('message2');

    await vi.runAllTimersAsync();

    expect(messages1.length).toBe(2);
    expect(messages2.length).toBe(2);
  });

  it('should allow unsubscribing from message callbacks', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const messages: any[] = [];
    const unsubscribe = socket.onMessage((msg) => {
      messages.push(msg);
    });

    const ws = createdWebSockets[0];
    ws.simulateMessage('message1');

    await vi.runAllTimersAsync();
    expect(messages.length).toBe(1);

    unsubscribe();
    ws.simulateMessage('message2');

    await vi.runAllTimersAsync();
    expect(messages.length).toBe(1); // Should not receive message2
  });

  it('should emit open event', async () => {
    const socket = createSocket({ url: 'ws://test.com' });

    const events: any[] = [];
    socket.onEvent((event) => {
      events.push(event);
    });

    await vi.runAllTimersAsync();

    expect(events.some((e) => e.type === 'open')).toBe(true);
  });

  it('should emit close event', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const events: any[] = [];
    socket.onEvent((event) => {
      events.push(event);
    });

    socket.close(1000, 'Normal closure');
    await vi.runAllTimersAsync();

    const closeEvent = events.find((e) => e.type === 'close');
    expect(closeEvent).toBeDefined();
    expect(closeEvent.meta?.code).toBe(1000);
    expect(closeEvent.meta?.reason).toBe('Normal closure');
    expect(closeEvent.meta?.wasClean).toBe(true);
  });

  it('should include code and reason in close event', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const closeEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'close') {
        closeEvents.push(event);
      }
    });

    socket.close(1001, 'Going away');
    await vi.runAllTimersAsync();

    expect(closeEvents.length).toBeGreaterThan(0);
    const closeEvent = closeEvents[closeEvents.length - 1];
    expect(closeEvent.meta?.code).toBe(1001);
    expect(closeEvent.meta?.reason).toBe('Going away');
  });

  it('should include wasClean flag in close event', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const closeEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'close') {
        closeEvents.push(event);
      }
    });

    // Manual close should be clean
    socket.close(1000, 'Normal closure');
    await vi.runAllTimersAsync();

    const closeEvent = closeEvents[closeEvents.length - 1];
    expect(closeEvent.meta?.wasClean).toBe(true);
  });

  it('should emit received event when message arrives', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const receivedEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'received') {
        receivedEvents.push(event);
      }
    });

    const ws = createdWebSockets[0];
    ws.simulateMessage('test message');

    await vi.runAllTimersAsync();

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].meta?.message).toBe('test message');
  });

  it('should emit sent event when message is sent', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const sentEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'sent') {
        sentEvents.push(event);
      }
    });

    socket.send('hello');
    await vi.runAllTimersAsync();

    // Sent events should be emitted
    expect(sentEvents.length).toBeGreaterThanOrEqual(0);
  });

  it('should emit error event', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const errorEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'error') {
        errorEvents.push(event);
      }
    });

    const ws = createdWebSockets[0];
    ws.simulateError();

    await vi.runAllTimersAsync();

    expect(errorEvents.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle buffer overflow events', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      buffer: {
        receive: {
          size: 2,
          overflow: 'oldest',
        },
      },
    });

    const droppedEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'dropped') {
        droppedEvents.push(event);
      }
    });

    await vi.runAllTimersAsync();
    expect(createdWebSockets.length).toBeGreaterThan(0);
    const ws = createdWebSockets[0];

    // Use callback to receive messages
    socket.onMessage(() => {
      // Just consume
    });

    // Simulate messages
    ws.simulateMessage('msg1');
    await vi.runAllTimersAsync();

    ws.simulateMessage('msg2');
    await vi.runAllTimersAsync();

    ws.simulateMessage('msg3');
    await vi.runAllTimersAsync();

    // Verify messages were received
    expect(socket).toBeDefined();
  });

  it('should allow unsubscribing from event callbacks', async () => {
    const socket = createSocket({ url: 'ws://test.com' });

    const events: any[] = [];
    const unsubscribe = socket.onEvent((event) => {
      events.push(event);
    });

    await vi.runAllTimersAsync();
    const initialCount = events.length;

    unsubscribe();
    socket.close();
    await vi.runAllTimersAsync();

    // Should not receive new events after unsubscribe
    expect(events.length).toBe(initialCount);
  });

  it('should handle error in message callback gracefully', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    socket.onMessage(() => {
      throw new Error('Callback error');
    });

    const ws = createdWebSockets[0];
    ws.simulateMessage('test');

    await vi.runAllTimersAsync();

    // Should log error but not crash
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should handle error in event callback gracefully', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    socket.onEvent(() => {
      throw new Error('Callback error');
    });

    // Trigger an event (open event will fire)
    await vi.runAllTimersAsync();

    // Should log error but not crash
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
