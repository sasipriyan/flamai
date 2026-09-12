export type ClientId = string;
export type RoomId = string;
export type RoomMode = "emoji" | "drawing";

export type CursorPoint = {
  x: number;
  y: number;
  seq: number;
  t: number;
};

export type DrawPoint = {
  x: number;
  y: number;
};

export type ParticipantSnapshot = {
  clientId: ClientId;
  name: string;
  color: string;
  lastSeen: number;
  cursor?: CursorPoint;
};

export type ClientToServerMessage =
  | {
      kind: "join";
      roomId: RoomId;
      clientId: ClientId;
      name: string;
      color: string;
      mode: RoomMode;
    }
  | {
      kind: "cursor";
      seq: number;
      t: number;
      x: number;
      y: number;
    }
  | {
      kind: "reaction";
      id: string;
      seq: number;
      t: number;
      x: number;
      y: number;
      emoji: string;
    }
  | {
      kind: "draw";
      id: string;
      seq: number;
      t: number;
      points: DrawPoint[];
      done: boolean;
    }
  | {
      kind: "ping";
      id: string;
      t: number;
    }
  | {
      kind: "leave";
    };

export type RemoteAction =
  | {
      kind: "cursor";
      clientId: ClientId;
      seq: number;
      t: number;
      serverTime: number;
      x: number;
      y: number;
    }
  | {
      kind: "reaction";
      clientId: ClientId;
      id: string;
      seq: number;
      t: number;
      serverTime: number;
      x: number;
      y: number;
      emoji: string;
    }
  | {
      kind: "draw";
      clientId: ClientId;
      id: string;
      seq: number;
      t: number;
      serverTime: number;
      points: DrawPoint[];
      done: boolean;
    };

export type ServerToClientMessage =
  | {
      kind: "welcome";
      roomId: RoomId;
      clientId: ClientId;
      mode: RoomMode;
      serverTime: number;
      participants: ParticipantSnapshot[];
    }
  | {
      kind: "presence";
      event: "join" | "leave" | "update";
      participant: ParticipantSnapshot;
    }
  | RemoteAction
  | {
      kind: "error";
      code: string;
      message: string;
    }
  | {
      kind: "pong";
      id: string;
      t: number;
      serverTime: number;
    };

export function parseServerMessage(raw: string): ServerToClientMessage | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || typeof value.kind !== "string") return undefined;

    switch (value.kind) {
      case "welcome":
        if (
          typeof value.roomId === "string" &&
          typeof value.clientId === "string" &&
          (value.mode === "emoji" || value.mode === "drawing") &&
          typeof value.serverTime === "number" &&
          Array.isArray(value.participants)
        ) {
          return value as ServerToClientMessage;
        }
        return undefined;
      case "presence":
        if (
          (value.event === "join" || value.event === "leave" || value.event === "update") &&
          isRecord(value.participant)
        ) {
          return value as ServerToClientMessage;
        }
        return undefined;
      case "cursor":
        if (isRemotePoint(value) && typeof value.clientId === "string") {
          return value as ServerToClientMessage;
        }
        return undefined;
      case "reaction":
        if (isRemotePoint(value) && typeof value.clientId === "string" && typeof value.emoji === "string") {
          return value as ServerToClientMessage;
        }
        return undefined;
      case "draw":
        if (
          typeof value.clientId === "string" &&
          typeof value.id === "string" &&
          typeof value.seq === "number" &&
          typeof value.t === "number" &&
          typeof value.serverTime === "number" &&
          Array.isArray(value.points) &&
          typeof value.done === "boolean"
        ) {
          return value as ServerToClientMessage;
        }
        return undefined;
      case "error":
        if (typeof value.message === "string") return value as ServerToClientMessage;
        return undefined;
      case "pong":
        if (typeof value.id === "string" && typeof value.t === "number" && typeof value.serverTime === "number") {
          return value as ServerToClientMessage;
        }
        return undefined;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function isRemotePoint(value: Record<string, unknown>): boolean {
  return (
    typeof value.seq === "number" &&
    typeof value.t === "number" &&
    typeof value.serverTime === "number" &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
