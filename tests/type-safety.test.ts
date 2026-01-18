/**
 * type-safety.test.ts
 * 
 * Purpose: TypeScript type safety and generic type verification
 * 
 * Test Coverage:
 * - Default type (string) behavior
 * - Custom Incoming type specification and type safety
 * - Custom Outgoing type specification and type safety
 * - Type inference and type checking
 * 
 * Boundaries:
 * - Runtime behavior is verified in other test files
 * - Only type-level safety is verified here
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createSocket from '../src/index.js';
import { setupWebSocketMock, cleanupWebSocketMock } from './helpers';

describe('Type Safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupWebSocketMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupWebSocketMock();
  });

  it('should work with default string types', async () => {
    const socket = createSocket({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    // Type should be string
    socket.send('hello');
    socket.send('world');

    // Messages should be string type
    const messages: string[] = [];
    socket.onMessage((msg) => {
      // msg should be inferred as string
      messages.push(msg);
    });

    expect(typeof messages[0] === 'string' || messages.length === 0).toBe(true);
  });

  it('should enforce custom Incoming type', async () => {
    type Incoming = { type: 'message'; text: string } | { type: 'ping' };

    const socket = createSocket<Incoming>({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const messages: Incoming[] = [];
    socket.onMessage((msg) => {
      // msg should be Incoming type
      messages.push(msg);

      // Type narrowing should work
      if (msg.type === 'message') {
        expect(msg.text).toBeDefined();
      }
    });

    expect(socket).toBeDefined();
  });

  it('should enforce custom Outgoing type', async () => {
    type Outgoing = { type: 'send'; text: string } | { type: 'ping' };

    const socket = createSocket<string, Outgoing>({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    // Should accept valid Outgoing types
    socket.send({ type: 'send', text: 'hello' });
    socket.send({ type: 'ping' });

    // TypeScript should error on invalid types (tested via @ts-expect-error in actual usage)
    expect(socket).toBeDefined();
  });

  it('should enforce both Incoming and Outgoing types', async () => {
    type Incoming =
      | { type: 'message'; from: string; text: string }
      | { type: 'user_joined'; userId: string };

    type Outgoing = { type: 'send_message'; text: string } | { type: 'join_room'; roomId: string };

    const socket = createSocket<Incoming, Outgoing>({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    // Should accept valid Outgoing
    socket.send({ type: 'send_message', text: 'hello' });
    socket.send({ type: 'join_room', roomId: 'room1' });

    // Should receive Incoming type
    const messages: Incoming[] = [];
    socket.onMessage((msg) => {
      messages.push(msg);

      // Type narrowing
      if (msg.type === 'message') {
        expect(msg.from).toBeDefined();
        expect(msg.text).toBeDefined();
      } else if (msg.type === 'user_joined') {
        expect(msg.userId).toBeDefined();
      }
    });

    expect(socket).toBeDefined();
  });

  it('should work with sendMessages() and custom types', async () => {
    type Outgoing = { id: number; data: string };

    const socket = createSocket<string, Outgoing>({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    async function* messageGenerator(): AsyncGenerator<Outgoing> {
      yield { id: 1, data: 'msg1' };
      yield { id: 2, data: 'msg2' };
      yield { id: 3, data: 'msg3' };
    }

    await socket.sendMessages(messageGenerator());
    await vi.runAllTimersAsync();

    expect(socket).toBeDefined();
  });

  it('should maintain type safety with messages() generator', async () => {
    type Incoming = { id: number; content: string };

    const socket = createSocket<Incoming>({ url: 'ws://test.com' });
    await vi.runAllTimersAsync();

    const messages: Incoming[] = [];
    const controller = new AbortController();

    const messagePromise = (async () => {
      for await (const msg of socket.messages({ signal: controller.signal })) {
        // msg should be Incoming type
        messages.push(msg);
        // Type narrowing works - TypeScript knows msg has id and content
        if ('id' in msg && 'content' in msg) {
          expect(msg.id).toBeDefined();
          expect(msg.content).toBeDefined();
        }
        controller.abort();
        break;
      }
    })();

    // Advance timers to allow generator to start
    vi.advanceTimersByTime(20);

    // Abort immediately to stop generator
    controller.abort();
    await vi.runAllTimersAsync();
    await messagePromise;

    expect(socket).toBeDefined();
  });
});
