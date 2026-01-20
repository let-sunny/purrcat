/**
 * connection-handler.test.ts
 *
 * Purpose: Unit tests for ConnectionHandler class
 *
 * Test Coverage:
 * - WebSocket connection creation
 * - Connection lifecycle (open, close, error)
 * - Reconnection scheduling
 * - Reconnection attempt limits
 * - Manual close vs automatic close
 * - AbortController cleanup
 * - Event emission for connection events
 *
 * Boundaries:
 * - Integration tests for reconnection logic are in integration/reconnection.test.ts
 * - Integration tests for connection API are in integration/basic.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionHandler } from '../../src/handlers/connection-handler.js';
import { EventHandler } from '../../src/handlers/event-handler.js';
import { MessageHandler } from '../../src/handlers/message-handler.js';
import { createState, normalizeOptions } from '../../src/utils.js';
import type { NormalizedSocketOptions } from '../../src/types.js';
import {
  setupWebSocketMock,
  cleanupWebSocketMock,
  createdWebSockets,
  MockWebSocket,
} from '../helpers.js';

describe('ConnectionHandler', () => {
  let handler: ConnectionHandler<string, string>;
  let eventHandler: EventHandler<string>;
  let messageHandler: MessageHandler<string, string>;
  let state: ReturnType<typeof createState<string>>;
  let opts: NormalizedSocketOptions;

  beforeEach(() => {
    vi.useFakeTimers();
    setupWebSocketMock();
    state = createState<string>();
    eventHandler = new EventHandler<string>(state);
    opts = normalizeOptions({ url: 'ws://test.com' });
    messageHandler = new MessageHandler<string, string>(state, opts, eventHandler);
    handler = new ConnectionHandler<string, string>(state, opts, eventHandler, messageHandler);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWebSocketMock();
  });

  describe('connect', () => {
    it('should create WebSocket connection', async () => {
      handler.connect();
      await vi.runAllTimersAsync();

      expect(createdWebSockets.length).toBe(1);
      expect(createdWebSockets[0].url).toBe('ws://test.com');
    });

    it('should create WebSocket with protocols', async () => {
      opts = normalizeOptions({
        url: 'ws://test.com',
        protocols: ['chat', 'json'],
      });
      handler = new ConnectionHandler<string, string>(state, opts, eventHandler, messageHandler);

      handler.connect();
      await vi.runAllTimersAsync();

      expect(createdWebSockets[0].protocols).toEqual(['chat', 'json']);
    });

    it('should emit open event on connection', async () => {
      const eventCallback = vi.fn();
      state.eventCallbacks.add(eventCallback);

      handler.connect();
      await vi.runAllTimersAsync();

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'open',
        })
      );
    });

    it('should reset reconnect count on open', async () => {
      state.reconnectCount = 5;

      handler.connect();
      await vi.runAllTimersAsync();

      expect(state.reconnectCount).toBe(0);
    });

    it('should flush message queue on open', async () => {
      state.messageQueue.push('msg1');
      state.messageQueue.push('msg2');

      const flushSpy = vi.spyOn(messageHandler, 'flushQueue');

      handler.connect();
      await vi.runAllTimersAsync();

      expect(flushSpy).toHaveBeenCalled();
    });

    it('should emit error event on WebSocket error', async () => {
      const eventCallback = vi.fn();
      state.eventCallbacks.add(eventCallback);

      handler.connect();
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      ws.simulateError();
      await vi.runAllTimersAsync();

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        })
      );
    });

    it('should emit close event with details', async () => {
      const eventCallback = vi.fn();
      state.eventCallbacks.add(eventCallback);

      handler.connect();
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      ws.close(1000, 'Normal closure');
      await vi.runAllTimersAsync();

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'close',
          meta: expect.objectContaining({
            code: 1000,
            reason: 'Normal closure',
            wasClean: true,
          }),
        })
      );
    });

    it('should not connect when abortController is aborted', () => {
      const controller = new AbortController();
      controller.abort();
      state.abortController = controller;

      handler.connect();

      // Should not create WebSocket
      expect(createdWebSockets.length).toBe(0);
    });

    it('should handle WebSocket constructor error', async () => {
      const originalWebSocket = global.WebSocket;
      global.WebSocket = vi.fn(() => {
        throw new Error('WebSocket construction failed');
      }) as unknown as typeof WebSocket;

      // Disable reconnect to prevent infinite loop
      opts.reconnect.enabled = false;
      handler = new ConnectionHandler<string, string>(state, opts, eventHandler, messageHandler);

      const eventCallback = vi.fn();
      state.eventCallbacks.add(eventCallback);

      handler.connect();
      await vi.runAllTimersAsync();

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        })
      );

      global.WebSocket = originalWebSocket;
    });
  });

  describe('close', () => {
    it('should close WebSocket connection', async () => {
      handler.connect();
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      handler.close(1000, 'Normal closure');
      await vi.runAllTimersAsync();

      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should set isManualClose flag', async () => {
      handler.connect();
      await vi.runAllTimersAsync();

      handler.close();

      expect(state.isManualClose).toBe(true);
    });

    it('should clear reconnect timer', async () => {
      handler.connect();
      await vi.runAllTimersAsync();

      // Trigger reconnection
      opts.reconnect.enabled = true;
      const ws = createdWebSockets[0];
      ws.close(1006, 'Abnormal closure');
      await vi.runAllTimersAsync();

      // Close should clear timer
      handler.close();

      expect(state.reconnectTimer).toBeNull();
    });

    it('should clear message queue', async () => {
      handler.connect();
      await vi.runAllTimersAsync();

      state.messageQueue.push('msg1');
      state.messageQueue.push('msg2');

      handler.close();

      expect(state.messageQueue.length).toBe(0);
    });

    it('should cleanup abortController', async () => {
      handler.connect();
      await vi.runAllTimersAsync();

      const controller = new AbortController();
      state.abortController = controller;

      handler.close();

      expect(state.abortController).toBeNull();
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('scheduleReconnect', () => {
    it('should schedule reconnection when enabled', async () => {
      opts.reconnect.enabled = true;
      opts.reconnect.attempts = 3;
      opts.reconnect.interval = 100;
      handler = new ConnectionHandler<string, string>(state, opts, eventHandler, messageHandler);

      handler.connect();
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      ws.close(1006, 'Abnormal closure');
      await vi.runAllTimersAsync();

      // Should schedule reconnect
      expect(state.reconnectTimer).not.toBeNull();
    });

    it('should not reconnect when manually closed', async () => {
      opts.reconnect.enabled = true;
      handler = new ConnectionHandler<string, string>(state, opts, eventHandler, messageHandler);

      handler.connect();
      await vi.runAllTimersAsync();

      handler.close();
      await vi.runAllTimersAsync();

      // Should not schedule reconnect
      expect(state.reconnectTimer).toBeNull();
    });

    it('should respect max reconnection attempts', async () => {
      opts.reconnect.enabled = true;
      opts.reconnect.attempts = 2;
      opts.reconnect.interval = 100;
      handler = new ConnectionHandler<string, string>(state, opts, eventHandler, messageHandler);

      handler.connect();
      await vi.runAllTimersAsync();

      // Trigger multiple reconnections
      for (let i = 0; i < 3; i++) {
        const ws = createdWebSockets[createdWebSockets.length - 1];
        ws.close(1006, 'Abnormal closure');
        await vi.runAllTimersAsync();
        vi.advanceTimersByTime(200);
        await vi.runAllTimersAsync();
      }

      // Should stop after max attempts
      expect(state.reconnectCount).toBeLessThanOrEqual(2);
    });

    it('should emit reconnect event', async () => {
      opts.reconnect.enabled = true;
      opts.reconnect.interval = 100;
      handler = new ConnectionHandler<string, string>(state, opts, eventHandler, messageHandler);

      const eventCallback = vi.fn();
      state.eventCallbacks.add(eventCallback);

      handler.connect();
      await vi.runAllTimersAsync();

      const ws = createdWebSockets[0];
      ws.close(1006, 'Abnormal closure');
      await vi.runAllTimersAsync();

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'reconnect',
        })
      );
    });
  });
});
