import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createRoomId, insertRoom, listRooms as listStoredRooms, type RoomDocument } from "./db.js";
import type { RoomHub } from "./room.js";
import type { RoomMode } from "./protocol.js";

const MAX_JSON_BYTES = 64 * 1024;

export async function handleApi(request: IncomingMessage, response: ServerResponse, hub: RoomHub): Promise<boolean> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (!url.pathname.startsWith("/api/")) return false;

  setCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return true;
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/rooms") {
      await listRooms(response, hub);
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      await createRoom(request, response);
      return true;
    }

    sendJson(response, 404, { error: "API route not found." });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = message.includes("MONGODB_URI") ? 503 : 500;
    sendJson(response, status, { error: message });
    return true;
  }
}

export function setCors(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

async function listRooms(response: ServerResponse, hub: RoomHub): Promise<void> {
  const rooms = await listStoredRooms();
  sendJson(response, 200, {
    rooms: rooms.map((room) => ({
      roomId: room.roomId,
      name: room.name,
      mode: room.mode,
      createdByName: room.createdByName,
      createdAt: room.createdAt,
      activeUsers: hub.getActiveUsers(room.roomId),
    })),
  });
}

async function createRoom(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 48) : "";
  const mode = body.mode;

  if (name.length < 3) return sendJson(response, 400, { error: "Room name must be at least 3 characters." });
  if (!isRoomMode(mode)) return sendJson(response, 400, { error: "Room mode must be emoji or drawing." });

  const now = new Date();
  const room: RoomDocument = {
    _id: randomUUID(),
    roomId: createRoomId(name),
    name,
    mode,
    createdBy: "dashboard",
    createdByName: "Dashboard",
    createdAt: now,
    updatedAt: now,
  };

  await insertRoom(room);
  sendJson(response, 201, {
    room: {
      roomId: room.roomId,
      name: room.name,
      mode: room.mode,
      createdByName: room.createdByName,
      createdAt: room.createdAt,
      activeUsers: [],
    },
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BYTES) throw new Error("JSON body is too large.");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON body must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isRoomMode(value: unknown): value is RoomMode {
  return value === "emoji" || value === "drawing";
}
