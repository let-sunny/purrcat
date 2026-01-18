import type {
  InternalSocketState,
  NormalizedSocketOptions,
} from '../types.js';
import { createEvent, calculateReconnectInterval } from '../utils.js';
import { EventHandler } from './event-handler.js';
import { MessageHandler } from './message-handler.js';

/**
 * Handles WebSocket connection, reconnection, and lifecycle management
 */
export class ConnectionHandler<Incoming, Outgoing> {
  constructor(
    private state: InternalSocketState<Incoming>,
    private opts: NormalizedSocketOptions,
    private eventHandler: EventHandler<Incoming>,
    private messageHandler: MessageHandler<Incoming, Outgoing>
  ) {}

  scheduleReconnect(): void {
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
    }

    if (this.state.reconnectCount >= this.opts.reconnect.attempts) {
      return;
    }

    const interval = calculateReconnectInterval(
      this.state.reconnectCount,
      this.opts.reconnect.interval,
      this.opts.reconnect.backoff,
      this.opts.reconnect.maxInterval
    );

    this.eventHandler.emit(
      createEvent('reconnect', {
        attempt: this.state.reconnectCount + 1,
        interval,
      })
    );

    this.state.reconnectTimer = setTimeout(() => {
      this.state.reconnectCount++;
      this.eventHandler.emit(
        createEvent('reconnect', {
          attempt: this.state.reconnectCount,
        })
      );
      this.connect();
    }, interval);
  }

  connect(): void {
    if (this.state.abortController?.signal.aborted) {
      return;
    }

    try {
      this.state.ws = this.opts.protocols
        ? new WebSocket(this.opts.url, this.opts.protocols)
        : new WebSocket(this.opts.url);

      this.state.ws.onopen = () => {
        this.state.reconnectCount = 0;
        this.eventHandler.emit(createEvent('open'));
        this.messageHandler.flushQueue();
      };

      this.state.ws.onmessage = (event) => {
        const data =
          typeof event.data === 'string' ? event.data : String(event.data);
        this.messageHandler.receive(data);
      };

      this.state.ws.onerror = (error) => {
        this.eventHandler.emit(createEvent('error', { error }));
      };

      this.state.ws.onclose = (event) => {
        this.eventHandler.emit(
          createEvent('close', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          })
        );
        if (
          !this.state.isManualClose &&
          this.opts.reconnect.enabled &&
          this.state.reconnectCount < this.opts.reconnect.attempts
        ) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      this.eventHandler.emit(createEvent('error', { error }));
      if (
        this.opts.reconnect.enabled &&
        this.state.reconnectCount < this.opts.reconnect.attempts
      ) {
        this.scheduleReconnect();
      }
    }
  }

  close(code?: number, reason?: string): void {
    this.state.isManualClose = true;
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
      this.state.reconnectTimer = null;
    }
    if (this.state.ws) {
      this.state.ws.close(code, reason);
      this.state.ws = null;
    }
    if (this.state.abortController) {
      this.state.abortController.abort();
      this.state.abortController = null;
    }
    this.state.messageQueue = [];
  }
}
