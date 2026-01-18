import type { SocketEvent, SocketEventType, ReconnectBackoff } from './types.js';

export function createEvent(
  type: SocketEventType,
  meta?: Record<string, any>
): SocketEvent {
  return {
    type,
    ts: Date.now(),
    meta,
  };
}

export function calculateReconnectInterval(
  attempt: number,
  baseInterval: number,
  backoff: ReconnectBackoff,
  maxInterval: number
): number {
  let interval: number;
  if (backoff === 'exponential') {
    interval = baseInterval * Math.pow(2, attempt);
  } else {
    interval = baseInterval * (attempt + 1);
  }

  // Add jitter (±20%)
  const jitter = interval * 0.2 * (Math.random() * 2 - 1);
  interval = Math.min(interval + jitter, maxInterval);

  return Math.max(0, Math.min(interval, maxInterval));
}
