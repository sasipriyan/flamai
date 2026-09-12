import type { RoomMode } from "./protocol";

export type RoomSummary = {
  roomId: string;
  name: string;
  mode: RoomMode;
  createdByName: string;
  createdAt: string;
  activeUsers: Array<{
    clientId: string;
    name: string;
    color: string;
  }>;
};

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.PROD ? "" : "http://localhost:8090");

export async function getRooms(): Promise<{ rooms: RoomSummary[] }> {
  return apiRequest<{ rooms: RoomSummary[] }>("/api/rooms");
}

export async function createStoredRoom(input: { name: string; mode: RoomMode }): Promise<{ room: RoomSummary }> {
  return apiRequest<{ room: RoomSummary }>("/api/rooms", {
    method: "POST",
    body: input,
  });
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}
