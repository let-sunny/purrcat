import type { InternalSocketState, SocketEvent } from '../types.js';
import { MAX_RECENT_EVENTS } from '../constants.js';

/**
 * Handles event emission and queue management
 */
export class EventHandler<Incoming> {
  constructor(private state: InternalSocketState<Incoming>) {}

  emit(event: SocketEvent): void {
    // Call all registered callbacks first (they don't use queue)
    this.state.eventCallbacks.forEach(cb => {
      try {
        cb(event);
      } catch (error) {
        console.error('Error in event callback:', error);
      }
    });

    // Queue events for iterators
    if (this.state.activeEventIterators > 0) {
      // Active iterators exist - add to queue and notify
      this.state.eventQueue.push(event);
      // Notify waiting iterators immediately
      // Copy the set to avoid issues if new resolvers are added during iteration
      const resolvers = Array.from(this.state.eventResolvers);
      this.state.eventResolvers.clear();
      resolvers.forEach(resolve => resolve());
      return;
    }

    // No active iterators - keep only recent events for when iterators start
    // This allows new iterators to receive recent events without memory leak
    this.state.eventQueue.push(event);
    if (this.state.eventQueue.length > MAX_RECENT_EVENTS) {
      this.state.eventQueue.shift(); // Remove oldest event
    }
  }
}
