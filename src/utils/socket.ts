import { io, Socket } from 'socket.io-client';

export type RealtimeClient = {
  on: (event: string, listener: (...args: any[]) => void) => RealtimeClient;
  off: (event: string, listener?: (...args: any[]) => void) => RealtimeClient;
  disconnect: () => void;
};

const noopSocket: RealtimeClient = {
  on: () => noopSocket,
  off: () => noopSocket,
  disconnect: () => undefined,
};

let socket: Socket | null = null;

const isRealtimeEnabled = () => {
  return import.meta.env.VITE_ENABLE_REALTIME === 'true' || import.meta.env.DEV;
};

export const getSocket = (): RealtimeClient => {
  if (!isRealtimeEnabled()) {
    return noopSocket;
  }

  if (!socket) {
    const token = localStorage.getItem('auth_token');
    socket = io({
      auth: {
        token,
      },
      withCredentials: true,
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect_error', (error) => {
      console.warn('Realtime connection unavailable. Continuing without realtime.', error.message);
    });
  }

  return socket;
};

export const reconnectSocket = (): RealtimeClient => {
  if (!isRealtimeEnabled()) {
    return noopSocket;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  return getSocket();
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
