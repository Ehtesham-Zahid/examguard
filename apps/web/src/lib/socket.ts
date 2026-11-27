import { io, type Socket } from 'socket.io-client';
import { API_BASE, getAccessToken, refreshAccessToken } from './api';

let socket: Socket | null = null;

export function getSocket() {
  if (socket) return socket;
  socket = io(API_BASE || window.location.origin, {
    auth: (cb) => cb({ token: getAccessToken() }),
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 5000,
  });
  socket.on('connect_error', async (err) => {
    // socket.io does not retry after a server-side rejection: refresh the token and reconnect ourselves
    if (err.message === 'unauthorized' && (await refreshAccessToken())) setTimeout(() => socket?.connect(), 500);
  });
  return socket;
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
