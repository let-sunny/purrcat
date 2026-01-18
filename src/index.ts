export { createSocket } from './socket.js';
export type {
  Socket,
  SocketOptions,
  SocketEvent,
  SocketEventType,
  BufferOverflowPolicy,
  ReconnectBackoff,
  BufferConfig,
  ReconnectConfig,
} from './types.js';

import { createSocket } from './socket.js';
export default createSocket;

// Type helper for users
export type { createSocket as CreateSocket };
