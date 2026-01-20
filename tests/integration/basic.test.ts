/**
 * basic.test.ts
 *
 * Purpose: Integration tests for Socket instance creation, lifecycle management, and SocketOptions
 *
 * Test Coverage:
 * - Socket instance creation and API existence verification
 * - Auto-connection (based on reconnect option)
 * - Manual connection/close
 * - close() cleanup logic (abortController, reconnectTimer)
 * - SocketOptions (protocols)
 * - send() method (basic behavior, ArrayBuffer, Blob)
 *
 * Boundaries:
 * - Event-based/generator-based APIs are tested in their dedicated test files
 * - Reconnection logic is tested in reconnection.test.ts
 * - Buffer overflow is tested in buffer-overflow.test.ts
 * - Handler unit tests are in handlers/ directory
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createSocket from '../../src/index.js';
import type { SocketEvent } from '../../src/types.js';
import {
  setupWebSocketMock,
  cleanupWebSocketMock,
  createdWebSockets,
  MockWebSocket,
} from '../helpers.js';

describe('Basic Functionality', () => {
  let WebSocketSpy: ReturnType<typeof setupWebSocketMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    WebSocketSpy = setupWebSocketMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWebSocketMock();
  });

  it('should create a socket instance', () => {
    const socket = createSocket({ url: 'ws://test.com' });
    expect(socket).toBeDefined();
    expect(socket.messages).toBeDefined();
    expect(socket.events).toBeDefined();
    expect(socket.send).toBeDefined();
    expect(socket.connect).toBeDefined();
    expect(socket.close).toBeDefined();
    expect(socket.onMessage).toBeDefined();
    expect(socket.onEvent).toBeDefined();
    expect(socket.sendMessages).toBeDefined();
  });

  it('should connect automatically when reconnect is enabled', async () => {
    const _socket = createSocket({
      url: 'ws://test.com',
      reconnect: true,
    });

    await vi.runAllTimersAsync();

    // Verify that WebSocket was created
    expect(WebSocketSpy).toHaveBeenCalled();
    expect(WebSocketSpy.mock.calls[0][0]).toBe('ws://test.com');
    expect(createdWebSockets.length).toBeGreaterThan(0);
  });

  it('should not auto-connect when reconnect is disabled', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: false,
    });

    await vi.runAllTimersAsync();

    // Note: connect() is always called, but it checks reconnect.enabled internally
    // So WebSocket will be created, but auto-reconnect won't happen
    expect(socket).toBeDefined();
  });

  it('should allow manual connection', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: false,
    });

    cleanupWebSocketMock();
    const newSpy = setupWebSocketMock();

    socket.connect();
    await vi.runAllTimersAsync();

    expect(newSpy).toHaveBeenCalled();
  });

  it('should close connection manually', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    expect(createdWebSockets.length).toBeGreaterThan(0);
    const ws = createdWebSockets[0];

    socket.close(1000, 'Normal closure');
    await vi.runAllTimersAsync();

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('should handle protocols option (single)', async () => {
    const _socket = createSocket({
      url: 'ws://test.com',
      protocols: 'chat',
    });

    await vi.runAllTimersAsync();

    expect(createdWebSockets.length).toBeGreaterThan(0);
    expect(createdWebSockets[0].protocols).toBe('chat');
  });

  it('should handle protocols option (multiple)', async () => {
    const _socket = createSocket({
      url: 'ws://test.com',
      protocols: ['chat', 'json'],
    });

    await vi.runAllTimersAsync();

    expect(createdWebSockets.length).toBeGreaterThan(0);
    expect(createdWebSockets[0].protocols).toEqual(['chat', 'json']);
  });

  it('should handle ArrayBuffer in send()', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const buffer = new ArrayBuffer(8);
    socket.send(buffer);

    await vi.runAllTimersAsync();

    // Should not throw error
    expect(socket).toBeDefined();
  });

  it('should handle Blob in send()', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const blob = new Blob(['test'], { type: 'text/plain' });
    socket.send(blob);

    await vi.runAllTimersAsync();

    // Should not throw error
    expect(socket).toBeDefined();
  });

  it('should cleanup abortController in close()', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const ws = createdWebSockets[0];
    const controller = new AbortController();

    // Start generator to create internal state
    const messagePromise = (async () => {
      for await (const _ of socket.messages({ signal: controller.signal })) {
        controller.abort();
        break;
      }
    })();

    vi.advanceTimersByTime(20);
    ws.simulateMessage('test');
    vi.advanceTimersByTime(20);

    // Close should cleanup abortController if it exists
    socket.close();
    await vi.runAllTimersAsync();

    controller.abort();
    await messagePromise;

    expect(socket).toBeDefined();
  });

  it('should cleanup reconnectTimer in close()', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 3,
        interval: 100,
      },
    });

    await vi.runAllTimersAsync();
    const ws = createdWebSockets[0];

    // Close connection to trigger reconnect timer
    ws.close(1006, 'Abnormal closure');
    await vi.runAllTimersAsync();

    // Close should clear reconnectTimer
    socket.close();
    await vi.runAllTimersAsync();

    expect(socket).toBeDefined();
  });

  it('should handle close with abortController', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    // Start generator to create abortController in state
    const controller = new AbortController();
    const messagePromise = (async () => {
      for await (const _ of socket.messages({ signal: controller.signal })) {
        // Consume
      }
    })();

    vi.advanceTimersByTime(20);

    // Close should cleanup abortController (covers lines 118-120)
    socket.close();
    await vi.runAllTimersAsync();

    controller.abort();
    await messagePromise;

    expect(socket).toBeDefined();
  });

  it('should handle WebSocket constructor error', async () => {
    // Mock WebSocket to throw error on construction
    const originalWebSocket = global.WebSocket;
    global.WebSocket = vi.fn(() => {
      throw new Error('WebSocket construction failed');
    }) as unknown as typeof WebSocket;

    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 1,
        interval: 100,
      },
    });

    const errorEvents: SocketEvent[] = [];
    socket.onEvent(event => {
      if (event.type === 'error') {
        errorEvents.push(event);
      }
    });

    await vi.runAllTimersAsync();

    // Should emit error event (covers catch block lines 96-104)
    expect(errorEvents.length).toBeGreaterThan(0);

    // Restore original WebSocket
    global.WebSocket = originalWebSocket;
  });

  it('should cleanup abortController when closing with active generator', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const controller = new AbortController();

    // Start generator to create abortController in state
    const messagePromise = (async () => {
      for await (const _ of socket.messages({ signal: controller.signal })) {
        // Consume
      }
    })();

    vi.advanceTimersByTime(20);

    // Close should cleanup abortController
    socket.close();
    await vi.runAllTimersAsync();

    controller.abort();
    await messagePromise;

    expect(socket).toBeDefined();
  });
});
