/**
 * event-handler.test.ts
 *
 * Purpose: Unit tests for EventHandler class
 *
 * Test Coverage:
 * - Event emission to callbacks
 * - Event queueing for iterators
 * - Event queue size limit (MAX_RECENT_EVENTS)
 * - Callback error handling
 * - Resolver notification for waiting iterators
 *
 * Boundaries:
 * - Integration tests for event-based API are in integration/api-callbacks.test.ts
 * - Integration tests for generator-based API are in integration/api-generators.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHandler } from '../../src/handlers/event-handler.js';
import { createState } from '../../src/utils.js';
import type { SocketEvent } from '../../src/types.js';
import { MAX_RECENT_EVENTS } from '../../src/constants.js';

describe('EventHandler', () => {
  let handler: EventHandler<string>;
  let state: ReturnType<typeof createState<string>>;

  beforeEach(() => {
    state = createState<string>();
    handler = new EventHandler<string>(state);
  });

  it('should call all registered event callbacks', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    state.eventCallbacks.add(callback1);
    state.eventCallbacks.add(callback2);

    const event: SocketEvent = { type: 'open', ts: Date.now() };
    handler.emit(event);

    expect(callback1).toHaveBeenCalledWith(event);
    expect(callback2).toHaveBeenCalledWith(event);
  });

  it('should handle callback errors gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const callback1 = vi.fn(() => {
      throw new Error('Callback error');
    });
    const callback2 = vi.fn();
    state.eventCallbacks.add(callback1);
    state.eventCallbacks.add(callback2);

    const event: SocketEvent = { type: 'open', ts: Date.now() };
    handler.emit(event);

    expect(callback1).toHaveBeenCalled();
    expect(callback2).toHaveBeenCalled(); // Should still call other callbacks
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should queue events when active iterators exist', () => {
    state.activeEventIterators = 1;
    const resolver = vi.fn();
    state.eventResolvers.add(resolver);

    const event: SocketEvent = { type: 'open', ts: Date.now() };
    handler.emit(event);

    expect(state.eventQueue).toContain(event);
    expect(resolver).toHaveBeenCalled();
    expect(state.eventResolvers.size).toBe(0); // Should clear resolvers
  });

  it('should notify all waiting resolvers', () => {
    state.activeEventIterators = 1;
    const resolver1 = vi.fn();
    const resolver2 = vi.fn();
    state.eventResolvers.add(resolver1);
    state.eventResolvers.add(resolver2);

    const event: SocketEvent = { type: 'open', ts: Date.now() };
    handler.emit(event);

    expect(resolver1).toHaveBeenCalled();
    expect(resolver2).toHaveBeenCalled();
  });

  it('should limit event queue size when no active iterators', () => {
    state.activeEventIterators = 0;

    // Emit more events than MAX_RECENT_EVENTS
    for (let i = 0; i < MAX_RECENT_EVENTS + 5; i++) {
      handler.emit({ type: 'open', ts: Date.now() });
    }

    // Should only keep MAX_RECENT_EVENTS
    expect(state.eventQueue.length).toBe(MAX_RECENT_EVENTS);
  });

  it('should keep all events when active iterators exist', () => {
    state.activeEventIterators = 1;

    // Emit more events than MAX_RECENT_EVENTS
    for (let i = 0; i < MAX_RECENT_EVENTS + 5; i++) {
      handler.emit({ type: 'open', ts: Date.now() });
    }

    // Should keep all events
    expect(state.eventQueue.length).toBe(MAX_RECENT_EVENTS + 5);
  });

  it('should remove oldest events when queue exceeds limit', () => {
    state.activeEventIterators = 0;

    // Emit events
    handler.emit({ type: 'open', ts: Date.now() });
    handler.emit({ type: 'close', ts: Date.now(), meta: { code: 1000 } });

    // Fill queue to limit
    for (let i = 0; i < MAX_RECENT_EVENTS - 1; i++) {
      handler.emit({ type: 'open', ts: Date.now() });
    }

    // First event should be removed
    expect(state.eventQueue[0].type).not.toBe('open');
    expect(state.eventQueue.length).toBe(MAX_RECENT_EVENTS);
  });
});
