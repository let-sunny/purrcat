import { vi } from 'vitest';

// Helper class for mocking WebSocket
export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  protocols?: string | string[];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sentMessages: (string | ArrayBuffer | Blob)[] = [];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    // Automatically simulate connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(data: string | ArrayBuffer | Blob) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      if (this.onclose) {
        const event = new CloseEvent('close', {
          code: code ?? 1000,
          reason: reason ?? '',
          wasClean: true,
        });
        this.onclose(event);
      }
    }, 0);
  }

  // Test helper: Simulate message from server
  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  // Test helper: Simulate error
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

// Track created WebSocket instances for testing
export let createdWebSockets: MockWebSocket[] = [];

// Create a spy function that wraps MockWebSocket
export function createWebSocketSpy() {
  return vi.fn((url: string, protocols?: string | string[]) => {
    const ws = new MockWebSocket(url, protocols);
    createdWebSockets.push(ws);
    return ws;
  });
}

// Setup function for tests
export function setupWebSocketMock() {
  createdWebSockets = [];
  const spy = createWebSocketSpy();
  global.WebSocket = spy as any;
  return spy;
}

// Cleanup function for tests
export function cleanupWebSocketMock() {
  createdWebSockets = [];
}
