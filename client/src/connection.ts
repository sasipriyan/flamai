import {
  type ClientId,
  type ClientToServerMessage,
  type DrawPoint,
  type ParticipantSnapshot,
  type RemoteAction,
  type RoomMode,
  type RoomId,
  parseServerMessage,
} from "./protocol";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export type RoomConnection = {
  clientId: ClientId;
  sendCursor: (x: number, y: number) => void;
  sendReaction: (x: number, y: number, emoji: string) => void;
  sendDraw: (id: string, points: DrawPoint[], done: boolean) => void;
  onRemoteAction: (listener: (clientId: ClientId, action: RemoteAction) => void) => () => void;
  onPresence: (listener: (participants: ParticipantSnapshot[]) => void) => () => void;
  onMode: (listener: (mode: RoomMode) => void) => () => void;
  onStatus: (listener: (status: ConnectionStatus) => void) => () => void;
  onError: (listener: (message: string) => void) => () => void;
  onLatency: (listener: (rttMs: number) => void) => () => void;
  close: () => void;
};

type CreateRoomOptions = {
  roomId: RoomId;
  clientId: ClientId;
  name: string;
  color: string;
  mode: RoomMode;
  url?: string;
};

const CURSOR_SEND_INTERVAL_MS = 33;
const MAX_RECONNECT_DELAY_MS = 4000;
const LATENCY_PROBE_INTERVAL_MS = 2000;

export function createRoom(options: CreateRoomOptions): RoomConnection {
  let socket: WebSocket | undefined;
  let status: ConnectionStatus = "connecting";
  let manualClose = false;
  let reconnectAttempt = 0;
  let seq = 0;
  let lastSendTime = 0;
  let queuedCursor: { x: number; y: number } | undefined;
  let cursorTimer: number | undefined;
  let queuedDraw:
    | {
        id: string;
        points: DrawPoint[];
        done: boolean;
      }
    | undefined;
  let drawTimer: number | undefined;
  let latencyTimer: number | undefined;
  let pageHideHandler: (() => void) | undefined;
  let participants = new Map<ClientId, ParticipantSnapshot>();

  const actionListeners = new Set<(clientId: ClientId, action: RemoteAction) => void>();
  const presenceListeners = new Set<(participants: ParticipantSnapshot[]) => void>();
  const modeListeners = new Set<(mode: RoomMode) => void>();
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const errorListeners = new Set<(message: string) => void>();
  const latencyListeners = new Set<(rttMs: number) => void>();

  connect();

  return {
    clientId: options.clientId,
    sendCursor,
    sendReaction,
    sendDraw,
    onRemoteAction: subscribe(actionListeners),
    onPresence: subscribe(presenceListeners),
    onMode: subscribe(modeListeners),
    onStatus: subscribe(statusListeners),
    onError: subscribe(errorListeners),
    onLatency: subscribe(latencyListeners),
    close: () => {
      manualClose = true;
      setStatus("closed");
      if (latencyTimer) window.clearInterval(latencyTimer);
      if (pageHideHandler) window.removeEventListener("pagehide", pageHideHandler);
      flushCursor();
      flushDraw();
      sendLeave();
      socket?.close(1000, "user left");
    },
  };

  function connect() {
    setStatus(reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const wsUrl = options.url ?? defaultWebSocketUrl();
    socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
      setStatus("open");
      startLatencyProbe();
      attachPageHide();
      send({
        kind: "join",
        roomId: options.roomId,
        clientId: options.clientId,
        name: options.name,
        color: options.color,
        mode: options.mode,
      });
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (!message) {
        emit(errorListeners, "Ignored malformed server message.");
        return;
      }
      handleServerMessage(message);
    });

    socket.addEventListener("close", () => {
      if (manualClose) {
        setStatus("closed");
        return;
      }

      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      emit(errorListeners, "WebSocket connection error.");
    });
  }

  function handleServerMessage(message: ReturnType<typeof parseServerMessage> extends infer T ? NonNullable<T> : never) {
    if (message.kind === "welcome") {
      participants = new Map(message.participants.map((participant) => [participant.clientId, participant]));
      emit(modeListeners, message.mode);
      emitPresence();
      return;
    }

    if (message.kind === "presence") {
      if (message.event === "leave") {
        participants.delete(message.participant.clientId);
      } else {
        participants.set(message.participant.clientId, message.participant);
      }
      emitPresence();
      return;
    }

    if (message.kind === "cursor" || message.kind === "reaction" || message.kind === "draw") {
      emit(actionListeners, message.clientId, message);
      return;
    }

    if (message.kind === "pong") {
      emit(latencyListeners, Math.max(0, Math.round(performance.now() - message.t)));
      return;
    }

    emit(errorListeners, message.message);
  }

  function sendCursor(x: number, y: number): void {
    queuedCursor = { x, y };
    const now = performance.now();
    const elapsed = now - lastSendTime;

    if (elapsed >= CURSOR_SEND_INTERVAL_MS) {
      flushCursor();
      return;
    }

    if (!cursorTimer) {
      cursorTimer = window.setTimeout(flushCursor, CURSOR_SEND_INTERVAL_MS - elapsed);
    }
  }

  function flushCursor(): void {
    if (cursorTimer) {
      window.clearTimeout(cursorTimer);
      cursorTimer = undefined;
    }
    if (!queuedCursor) return;

    const cursor = queuedCursor;
    queuedCursor = undefined;
    lastSendTime = performance.now();
    send({
      kind: "cursor",
      seq: nextSeq(),
      t: lastSendTime,
      x: clamp01(cursor.x),
      y: clamp01(cursor.y),
    });
  }

  function sendReaction(x: number, y: number, emoji: string): void {
    send({
      kind: "reaction",
      id: crypto.randomUUID(),
      seq: nextSeq(),
      t: performance.now(),
      x: clamp01(x),
      y: clamp01(y),
      emoji,
    });
  }

  function sendDraw(id: string, points: DrawPoint[], done: boolean): void {
    const sanitized = points.map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }));
    if (sanitized.length === 0) return;

    if (!queuedDraw || queuedDraw.id !== id) {
      flushDraw();
      queuedDraw = { id, points: [], done: false };
    }

    queuedDraw.points.push(...sanitized);
    queuedDraw.done = queuedDraw.done || done;

    if (done || queuedDraw.points.length >= 8) {
      flushDraw();
      return;
    }

    if (!drawTimer) {
      drawTimer = window.setTimeout(flushDraw, CURSOR_SEND_INTERVAL_MS);
    }
  }

  function flushDraw(): void {
    if (drawTimer) {
      window.clearTimeout(drawTimer);
      drawTimer = undefined;
    }
    if (!queuedDraw || queuedDraw.points.length === 0) return;

    const batch = queuedDraw;
    queuedDraw = undefined;
    send({
      kind: "draw",
      id: batch.id,
      seq: nextSeq(),
      t: performance.now(),
      points: batch.points.slice(0, 12),
      done: batch.done,
    });
  }

  function send(message: ClientToServerMessage): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendLeave(): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: "leave" } satisfies ClientToServerMessage));
    }
  }

  function attachPageHide(): void {
    if (pageHideHandler) return;
    pageHideHandler = () => {
      sendLeave();
    };
    window.addEventListener("pagehide", pageHideHandler);
  }

  function startLatencyProbe(): void {
    if (latencyTimer) window.clearInterval(latencyTimer);
    const probe = () => {
      send({
        kind: "ping",
        id: crypto.randomUUID(),
        t: performance.now(),
      });
    };
    probe();
    latencyTimer = window.setInterval(probe, LATENCY_PROBE_INTERVAL_MS);
  }

  function scheduleReconnect() {
    reconnectAttempt += 1;
    setStatus("reconnecting");
    const delay = Math.min(250 * 2 ** (reconnectAttempt - 1), MAX_RECONNECT_DELAY_MS);
    window.setTimeout(connect, delay);
  }

  function setStatus(next: ConnectionStatus): void {
    status = next;
    emit(statusListeners, status);
  }

  function emitPresence() {
    emit(presenceListeners, [...participants.values()]);
  }

  function nextSeq(): number {
    seq += 1;
    return seq;
  }
}

function defaultWebSocketUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return explicit;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "localhost";
  const port = import.meta.env.PROD ? "" : ":8090";
  const path = import.meta.env.PROD ? "/api/room" : "/room";
  return `${protocol}//${host}${port}${path}`;
}

function subscribe<T extends (...args: never[]) => void>(set: Set<T>) {
  return (listener: T) => {
    set.add(listener);
    return () => set.delete(listener);
  };
}

function emit<T extends (...args: never[]) => void>(set: Set<T>, ...args: Parameters<T>): void {
  for (const listener of set) {
    listener(...args);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
