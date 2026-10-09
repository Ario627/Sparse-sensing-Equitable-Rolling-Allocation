import { type ServerEvent, serverEventSchema } from "@sera/contracts";
import { io, type Socket } from "socket.io-client";
import { readAccessToken } from "@/lib/auth/session-store.ts";

const EVENT_CHANNEL = "sera.event";
const SOCKET_PATH = "/socket.io";
const RECONNECT_DELAY_MS = 800;
const RECONNECT_DELAY_MAX_MS = 8_000;
const RECONNECT_RANDOMIZATION = 0.5;
const CONNECT_TIMEOUT_MS = 10_000;

export type SocketState = "disconnected" | "connecting" | "connected";

type SocketStateListener = (state: SocketState) => void;
type ServerEventListener = (event: ServerEvent) => void;

let socket: Socket | null = null;
let currentState: SocketState = "disconnected";
let lastEventAt: string | null = null;
const stateListeners = new Set<SocketStateListener>();
const eventListeners = new Set<ServerEventListener>();

function setState(next: SocketState): void {
  if (currentState === next) {
    return;
  }
  currentState = next;
  for (const listener of Array.from(stateListeners)) {
    listener(next);
  }
}

function emitEvent(event: ServerEvent): void {
  lastEventAt = new Date().toISOString();
  for (const listener of Array.from(eventListeners)) {
    listener(event);
  }
}

function handlePayload(payload: unknown): void {
  const parsed = serverEventSchema.safeParse(payload);
  if (!parsed.success) {
    if (import.meta.env.DEV) {
      console.warn("realtime: dropping event outside contract", parsed.error.issues);
    }
    return;
  }
  emitEvent(parsed.data);
}

function attachHandlers(instance: Socket): Socket {
  instance.on("connect", () => {
    setState("connected");
  });
  instance.on("disconnect", () => {
    setState("disconnected");
  });
  instance.on("connect_error", () => {
    setState("connecting");
  });
  instance.io.on("reconnect_attempt", () => {
    setState("connecting");
  });
  instance.io.on("reconnect_failed", () => {
    setState("disconnected");
  });
  instance.on(EVENT_CHANNEL, handlePayload);
  return instance;
}

function createSocket(): Socket {
  return attachHandlers(
    io({
      path: SOCKET_PATH,
      autoConnect: false,
      auth: (callback) => {
        callback({ token: readAccessToken() ?? "" });
      },
      reconnection: true,
      reconnectionDelay: RECONNECT_DELAY_MS,
      reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
      randomizationFactor: RECONNECT_RANDOMIZATION,
      timeout: CONNECT_TIMEOUT_MS,
    }),
  );
}

export function socketState(): SocketState {
  return currentState;
}

export function readLastEventAt(): string | null {
  return lastEventAt;
}

export function subscribeSocketState(listener: SocketStateListener): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function subscribeServerEvents(listener: ServerEventListener): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

export function openSocket(): void {
  if (socket === null) {
    socket = createSocket();
  }
  if (socket.connected) {
    setState("connected");
    return;
  }
  setState("connecting");
  socket.connect();
}

export function closeSocket(): void {
  if (socket === null) {
    return;
  }
  socket.disconnect();
  setState("disconnected");
}

export function retryConnection(): void {
  if (socket === null) {
    openSocket();
    return;
  }
  if (socket.connected) {
    return;
  }
  setState("connecting");
  socket.connect();
}
