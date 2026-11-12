import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
const SOCKET_ORIGIN = (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export function getSocket(): Socket {
  // The browser sends the HttpOnly session cookie; no JWT is exposed to JS.
  if (!SOCKET_ORIGIN) throw new Error("The realtime API URL is not configured. Set VITE_SOCKET_URL in the frontend deployment settings.");
  if (!socket) socket = io(SOCKET_ORIGIN, { withCredentials: true });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
