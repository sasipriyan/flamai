export type ClientId = string;
export type RoomId = string;
export type RoomMode = "emoji" | "drawing";

export type ParticipantSnapshot = {
  clientId: ClientId;
  name: string;
  color: string;
  lastSeen: number;
  cursor?: CursorPoint;
};

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
    }
  | {
      kind: "error";
      code: "bad-json" | "bad-message" | "not-joined" | "stale-sequence" | "room-not-found";
      message: string;
    }
  | {
      kind: "pong";
      id: string;
      t: number;
      serverTime: number;
    };

export type ParseResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      reason: string;
    };

const MAX_ID_LENGTH = 80;
const MAX_NAME_LENGTH = 32;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const REACTION_PATTERN = /^\p{Emoji_Presentation}|\p{Extended_Pictographic}$/u;

export function parseClientMessage(raw: string): ParseResult<ClientToServerMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Invalid JSON." };
  }

  if (!isRecord(parsed) || typeof parsed.kind !== "string") {
    return { ok: false, reason: "Message must be an object with a string kind." };
  }

  switch (parsed.kind) {
    case "join":
      return parseJoin(parsed);
    case "cursor":
      return parseCursor(parsed);
    case "reaction":
      return parseReaction(parsed);
    case "draw":
      return parseDraw(parsed);
    case "ping":
      return parsePing(parsed);
    case "leave":
      return { ok: true, value: { kind: "leave" } };
    default:
      return { ok: false, reason: `Unknown message kind: ${parsed.kind}` };
  }
}

export function encodeServerMessage(message: ServerToClientMessage): string {
  return JSON.stringify(message);
}

function parseJoin(value: Record<string, unknown>): ParseResult<ClientToServerMessage> {
  if (!isId(value.roomId)) return { ok: false, reason: "roomId is required." };
  if (!isId(value.clientId)) return { ok: false, reason: "clientId is required." };
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return { ok: false, reason: "name is required." };
  }
  if (value.name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `name must be at most ${MAX_NAME_LENGTH} characters.` };
  }
  if (typeof value.color !== "string" || !HEX_COLOR_PATTERN.test(value.color)) {
    return { ok: false, reason: "color must be a #RRGGBB value." };
  }
  if (!isRoomMode(value.mode)) {
    return { ok: false, reason: "mode must be emoji or drawing." };
  }
  return {
    ok: true,
    value: {
      kind: "join",
      roomId: value.roomId,
      clientId: value.clientId,
      name: value.name.trim(),
      color: value.color,
      mode: value.mode,
    },
  };
}

function parseCursor(value: Record<string, unknown>): ParseResult<ClientToServerMessage> {
  const point = parsePoint(value);
  if (!point.ok) return point;

  return {
    ok: true,
    value: {
      kind: "cursor",
      ...point.value,
    },
  };
}

function parseReaction(value: Record<string, unknown>): ParseResult<ClientToServerMessage> {
  const point = parsePoint(value);
  if (!point.ok) return point;
  if (!isId(value.id)) return { ok: false, reason: "reaction id is required." };
  if (typeof value.emoji !== "string" || value.emoji.length > 8 || !REACTION_PATTERN.test(value.emoji)) {
    return { ok: false, reason: "emoji must be a single emoji-like character." };
  }

  return {
    ok: true,
    value: {
      kind: "reaction",
      id: value.id,
      emoji: value.emoji,
      ...point.value,
    },
  };
}

function parseDraw(value: Record<string, unknown>): ParseResult<ClientToServerMessage> {
  if (!isId(value.id)) return { ok: false, reason: "draw id is required." };
  if (!isPositiveInteger(value.seq)) return { ok: false, reason: "seq must be a positive integer." };
  if (!isFiniteNumber(value.t)) return { ok: false, reason: "t must be a finite number." };
  if (typeof value.done !== "boolean") return { ok: false, reason: "done must be a boolean." };
  if (!Array.isArray(value.points) || value.points.length === 0 || value.points.length > 12) {
    return { ok: false, reason: "points must contain 1-12 draw points." };
  }

  const points: DrawPoint[] = [];
  for (const point of value.points) {
    if (!isRecord(point) || !isUnit(point.x) || !isUnit(point.y)) {
      return { ok: false, reason: "each draw point must have x/y between 0 and 1." };
    }
    points.push({ x: point.x, y: point.y });
  }

  return {
    ok: true,
    value: {
      kind: "draw",
      id: value.id,
      seq: value.seq,
      t: value.t,
      points,
      done: value.done,
    },
  };
}

function parsePing(value: Record<string, unknown>): ParseResult<ClientToServerMessage> {
  if (!isId(value.id)) return { ok: false, reason: "ping id is required." };
  if (!isFiniteNumber(value.t)) return { ok: false, reason: "t must be a finite number." };

  return {
    ok: true,
    value: {
      kind: "ping",
      id: value.id,
      t: value.t,
    },
  };
}

function parsePoint(value: Record<string, unknown>): ParseResult<CursorPoint> {
  if (!isPositiveInteger(value.seq)) return { ok: false, reason: "seq must be a positive integer." };
  if (!isFiniteNumber(value.t)) return { ok: false, reason: "t must be a finite number." };
  if (!isUnit(value.x)) return { ok: false, reason: "x must be between 0 and 1." };
  if (!isUnit(value.y)) return { ok: false, reason: "y must be between 0 and 1." };

  return {
    ok: true,
    value: {
      seq: value.seq,
      t: value.t,
      x: value.x,
      y: value.y,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[a-zA-Z0-9._:-]+$/.test(value)
  );
}

function isRoomMode(value: unknown): value is RoomMode {
  return value === "emoji" || value === "drawing";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function isUnit(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}
