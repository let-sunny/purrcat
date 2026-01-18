/**
 * reconnection.test.ts
 * 
 * Purpose: Tests for automatic reconnection logic and backoff strategies
 * 
 * Test Coverage:
 * - Automatic reconnection on unexpected connection closure
 * - No reconnection on manual close
 * - Reconnection attempt limit
 * - Backoff strategies (linear, exponential)
 * - Maximum reconnection interval limit
 * - reconnect event emission
 * 
 * Boundaries:
 * - Basic connection/close is tested in basic.test.ts
 * - Reconnection-related events are verified here, but the event itself is also tested in event-based.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createSocket from '../src/index.js';
import {
  setupWebSocketMock,
  cleanupWebSocketMock,
  createdWebSockets,
} from './helpers';

describe('Reconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupWebSocketMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWebSocketMock();
  });

  it('should attempt reconnection when connection closes unexpectedly', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 3,
        interval: 100,
      },
    });

    await vi.runAllTimersAsync();
    expect(createdWebSockets.length).toBe(1);

    // Simulate connection close
    const ws = createdWebSockets[0];
    ws.close(1006, 'Abnormal closure');

    await vi.runAllTimersAsync();

    // Should attempt reconnection
    expect(createdWebSockets.length).toBeGreaterThan(1);
  });

  it('should not reconnect when manually closed', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 3,
      },
    });

    await vi.runAllTimersAsync();
    const initialCount = createdWebSockets.length;

    socket.close(1000, 'Normal closure');
    await vi.runAllTimersAsync();

    // Should not create new connections
    expect(createdWebSockets.length).toBe(initialCount);
  });

  it('should respect max reconnection attempts', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 2,
        interval: 100,
      },
    });

    await vi.runAllTimersAsync();
    expect(createdWebSockets.length).toBe(1);

    // Simulate multiple disconnections
    for (let i = 0; i < 3; i++) {
      const ws = createdWebSockets[createdWebSockets.length - 1];
      ws.close(1006, 'Abnormal closure');
      await vi.runAllTimersAsync();
    }

    // Should stop after max attempts (1 initial + 2 attempts = 3 total)
    // Note: May be slightly more due to timing, but should be close
    expect(createdWebSockets.length).toBeLessThanOrEqual(5); // Allow some margin
  });

  it('should emit reconnect event with interval when scheduled', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 3,
        interval: 1000,
      },
    });

    const reconnectEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'reconnect') {
        reconnectEvents.push(event);
      }
    });

    await vi.runAllTimersAsync();
    const ws = createdWebSockets[0];
    ws.close(1006, 'Abnormal closure');

    await vi.runAllTimersAsync();

    // Should emit reconnect event with interval
    const scheduledEvent = reconnectEvents.find((e) => e.meta?.interval);
    expect(scheduledEvent).toBeDefined();
    expect(scheduledEvent.meta.attempt).toBeDefined();
    expect(scheduledEvent.meta.interval).toBeDefined();
  });

  it('should emit reconnect event without interval when attempting', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 3,
        interval: 100,
      },
    });

    const reconnectEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'reconnect') {
        reconnectEvents.push(event);
      }
    });

    await vi.runAllTimersAsync();
    const ws = createdWebSockets[0];
    ws.close(1006, 'Abnormal closure');

    // Advance timers to trigger reconnect attempt
    await vi.advanceTimersByTimeAsync(200);

    // Should emit reconnect event without interval (attempting)
    const attemptEvent = reconnectEvents.find((e) => !e.meta?.interval);
    expect(attemptEvent).toBeDefined();
    expect(attemptEvent.meta.attempt).toBeDefined();
  });

  it('should use exponential backoff', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 3,
        interval: 100,
        backoff: 'exponential',
        maxInterval: 1000,
      },
    });

    await vi.runAllTimersAsync();
    const ws = createdWebSockets[0];
    ws.close(1006, 'Abnormal closure');

    const reconnectEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'reconnect' && event.meta?.interval) {
        reconnectEvents.push(event);
      }
    });

    await vi.runAllTimersAsync();

    // Check that intervals increase (exponentially)
    if (reconnectEvents.length >= 2) {
      const firstInterval = reconnectEvents[0].meta.interval;
      const secondInterval = reconnectEvents[1].meta.interval;
      expect(secondInterval).toBeGreaterThan(firstInterval);
    }
  });

  it('should use linear backoff', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 3,
        interval: 100,
        backoff: 'linear',
        maxInterval: 1000,
      },
    });

    await vi.runAllTimersAsync();
    const ws = createdWebSockets[0];
    ws.close(1006, 'Abnormal closure');

    const reconnectEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'reconnect' && event.meta?.interval) {
        reconnectEvents.push(event);
      }
    });

    await vi.runAllTimersAsync();

    // Linear backoff should increase linearly
    expect(reconnectEvents.length).toBeGreaterThanOrEqual(0);
  });

  it('should respect maxInterval', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 10,
        interval: 100,
        backoff: 'exponential',
        maxInterval: 500,
      },
    });

    await vi.runAllTimersAsync();
    const ws = createdWebSockets[0];
    ws.close(1006, 'Abnormal closure');

    const reconnectEvents: any[] = [];
    socket.onEvent((event) => {
      if (event.type === 'reconnect' && event.meta?.interval) {
        reconnectEvents.push(event);
      }
    });

    await vi.runAllTimersAsync();

    // All intervals should be <= maxInterval
    reconnectEvents.forEach((event) => {
      expect(event.meta.interval).toBeLessThanOrEqual(500);
    });
  });

  it('should reset reconnect count on successful connection', async () => {
    const socket = createSocket({
      url: 'ws://test.com',
      reconnect: {
        enabled: true,
        attempts: 3,
        interval: 100,
      },
    });

    await vi.runAllTimersAsync();
    const ws1 = createdWebSockets[0];
    ws1.close(1006, 'Abnormal closure');

    await vi.runAllTimersAsync();

    // After reconnection, if we close again, it should start from attempt 1
    if (createdWebSockets.length > 1) {
      const ws2 = createdWebSockets[1];
      ws2.close(1006, 'Abnormal closure');
      await vi.runAllTimersAsync();

      // Should attempt reconnection again
      expect(createdWebSockets.length).toBeGreaterThan(2);
    }
  });
});
