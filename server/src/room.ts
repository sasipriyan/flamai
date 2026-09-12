import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  ClientId,
  ClientToServerMessage,
  ParticipantSnapshot,
  RoomMode,
  RoomId,
  ServerToClientMessage,
} from "./protocol.js";
import { encodeServerMessage, parseClientMessage } from "./protocol.js";
import type { CloseInfo, RawWebSocket } from "./websocket.js";

const HEARTBEAT_INTERVAL_MS = 5_000;
const ROOM_SWEEP_INTERVAL_MS = 3_000;
const STALE_SESSION_MS = 8_000;

export class RoomHub {
  private readonly rooms = new Map<RoomId, Room>();

  constructor(private readonly resolveRoom: (roomId: RoomId) => Promise<{ roomId: RoomId; mode: RoomMode } | undefined>) {
    setInterval(() => this.sweep(), ROOM_SWEEP_INTERVAL_MS).unref();
  }

  attach(socket: RawWebSocket): void {
    let session: ClientSession;
    session = new ClientSession(
      socket,
      (message) => this.handle(session, message),
      () => {
        session.room?.removeSession(session, "leave");
      },
    );

    socket.on("message", (raw: string) => session.handleRaw(raw));
  }

  private async handle(session: ClientSession, message: ClientToServerMessage): Promise<void> {
    if (message.kind === "join") {
      const roomDefinition = await this.resolveRoom(message.roomId);
      if (!roomDefinition) {
        session.send({
          kind: "error",
          code: "room-not-found",
          message: "Create the room before joining it.",
        });
        return;
      }

      const room = this.getRoom(roomDefinition.roomId, roomDefinition.mode);
      room.join(session, {
        ...message,
        mode: roomDefinition.mode,
      });
      return;
    }

    if (message.kind === "ping") {
      session.send({
        kind: "pong",
        id: message.id,
        t: message.t,
        serverTime: Date.now(),
      });
      return;
    }

    if (message.kind === "leave") {
      session.room?.removeSession(session, "leave");
      return;
    }

    if (!session.room) {
      session.send({
        kind: "error",
        code: "not-joined",
        message: "Join a room before sending actions.",
      });
      return;
    }

    session.room.handleAction(session, message);
  }

  private getRoom(roomId: RoomId, mode: RoomMode): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, mode);
      this.rooms.set(roomId, room);
    }
    return room;
  }

  getActiveUsers(roomId: RoomId): Array<{ clientId: ClientId; name: string; color: string }> {
    return this.rooms.get(roomId)?.getActiveUsers() ?? [];
  }

  private sweep(): void {
    for (const [roomId, room] of this.rooms) {
      room.removeInactive(Date.now());
      if (room.isEmpty()) {
        room.dispose();
        this.rooms.delete(roomId);
      }
    }
  }
}

export class ClientSession extends EventEmitter {
  readonly connectionId = randomUUID();
  room?: Room;
  clientId: ClientId = "";
  lastSeq = 0;
  name = "Guest";
  color = "#2f80ed";
  lastSeen = Date.now();
  private alive = true;
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly socket: RawWebSocket,
    private readonly onMessage: (message: ClientToServerMessage) => void | Promise<void>,
    private readonly onClose: () => void,
  ) {
    super();
    socket.on("pong", () => {
      this.alive = true;
      this.lastSeen = Date.now();
    });
    socket.on("close", (_info: CloseInfo) => this.close());
    socket.on("error", () => this.close());
    this.heartbeat = setInterval(() => this.checkHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  handleRaw(raw: string): void {
    this.alive = true;
    this.lastSeen = Date.now();

    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.send({
        kind: "error",
        code: parsed.reason === "Invalid JSON." ? "bad-json" : "bad-message",
        message: parsed.reason,
      });
      return;
    }

    Promise.resolve(this.onMessage(parsed.value)).catch((error: unknown) => {
      this.send({
        kind: "error",
        code: "bad-message",
        message: error instanceof Error ? error.message : "Unable to handle message.",
      });
    });
  }

  send(message: ServerToClientMessage): void {
    this.socket.sendText(encodeServerMessage(message));
  }

  replaceWith(reason = "reconnected from another tab"): void {
    this.socket.close(4000, reason);
    this.close();
  }

  close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    this.onClose();
  }

  private checkHeartbeat(): void {
    if (!this.alive) {
      this.socket.close(4001, "heartbeat timeout");
      this.close();
      return;
    }

    this.alive = false;
    this.socket.sendPing();
  }
}

export class Room {
  private readonly sessions = new Map<ClientId, ClientSession>();
  private readonly participants = new Map<ClientId, ParticipantSnapshot>();
  private readonly mode: RoomMode;

  constructor(
    readonly roomId: RoomId,
    mode: RoomMode,
  ) {
    this.mode = mode;
  }

  join(
    session: ClientSession,
    message: Extract<ClientToServerMessage, { kind: "join" }>,
  ): void {
    const existing = this.sessions.get(message.clientId);
    if (existing && existing.connectionId !== session.connectionId) {
      this.sessions.delete(message.clientId);
      existing.room = undefined;
      existing.replaceWith();
    }

    session.room = this;
    session.clientId = message.clientId;
    session.name = message.name;
    session.color = message.color;
    session.lastSeq = this.participants.get(message.clientId)?.cursor?.seq ?? 0;
    session.lastSeen = Date.now();

    const participant: ParticipantSnapshot = {
      ...this.participants.get(message.clientId),
      clientId: message.clientId,
      name: message.name,
      color: message.color,
      lastSeen: session.lastSeen,
    };

    this.sessions.set(message.clientId, session);
    this.participants.set(message.clientId, participant);

    session.send({
      kind: "welcome",
      roomId: this.roomId,
      clientId: message.clientId,
      mode: this.mode,
      serverTime: Date.now(),
      participants: this.snapshot(),
    });

    this.broadcast(
      {
        kind: "presence",
        event: existing ? "update" : "join",
        participant,
      },
      message.clientId,
    );
  }

  handleAction(
    session: ClientSession,
    message: Exclude<ClientToServerMessage, { kind: "join" | "ping" | "leave" }>,
  ): void {
    if (message.seq <= session.lastSeq) {
      session.send({
        kind: "error",
        code: "stale-sequence",
        message: `Dropped stale sequence ${message.seq}; latest is ${session.lastSeq}.`,
      });
      return;
    }

    session.lastSeq = message.seq;
    session.lastSeen = Date.now();
    const participant = this.participants.get(session.clientId);
    if (participant) {
      participant.lastSeen = session.lastSeen;
    }

    if (message.kind === "cursor") {
      if (participant) {
        participant.cursor = {
          x: message.x,
          y: message.y,
          seq: message.seq,
          t: message.t,
        };
      }

      this.broadcast(
        {
          kind: "cursor",
          clientId: session.clientId,
          seq: message.seq,
          t: message.t,
          serverTime: Date.now(),
          x: message.x,
          y: message.y,
        },
        session.clientId,
      );
      return;
    }

    if (message.kind === "draw") {
      this.broadcast(
        {
          kind: "draw",
          clientId: session.clientId,
          id: message.id,
          seq: message.seq,
          t: message.t,
          serverTime: Date.now(),
          points: message.points,
          done: message.done,
        },
        session.clientId,
      );
      return;
    }

    this.broadcast(
      {
        kind: "reaction",
        clientId: session.clientId,
        id: message.id,
        seq: message.seq,
        t: message.t,
        serverTime: Date.now(),
        x: message.x,
        y: message.y,
        emoji: message.emoji,
      },
      session.clientId,
    );
  }

  removeSession(session: ClientSession, event: "leave" = "leave"): void {
    const clientId = session.clientId;
    if (this.sessions.get(clientId)?.connectionId !== session.connectionId) return;

    this.sessions.delete(clientId);
    session.room = undefined;
    const participant = this.participants.get(clientId);
    this.participants.delete(clientId);

    if (participant) {
      this.broadcast({
        kind: "presence",
        event,
        participant,
      });
    }
  }

  removeInactive(now: number): void {
    for (const session of this.sessions.values()) {
      if (now - session.lastSeen > STALE_SESSION_MS) {
        this.removeSession(session, "leave");
        session.replaceWith("inactive client expired");
      }
    }
  }

  getActiveUsers(): Array<{ clientId: ClientId; name: string; color: string }> {
    return [...this.participants.values()].map((participant) => ({
      clientId: participant.clientId,
      name: participant.name,
      color: participant.color,
    }));
  }

  isEmpty(): boolean {
    return this.sessions.size === 0;
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.replaceWith("room disposed");
    }
    this.sessions.clear();
    this.participants.clear();
  }

  private snapshot(): ParticipantSnapshot[] {
    return [...this.participants.values()];
  }

  private broadcast(message: ServerToClientMessage, exceptClientId?: ClientId): void {
    for (const [clientId, session] of this.sessions) {
      if (clientId !== exceptClientId) {
        session.send(message);
      }
    }
  }
}
