import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi, setCors } from "./api.js";
import { findRoomById } from "./db.js";
import { RoomHub } from "./room.js";
import { upgradeToWebSocket } from "./websocket.js";

const CLIENT_DIST = resolve(fileURLToPath(new URL("../../client/dist", import.meta.url)));

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function createAppServer() {
  const hub = new RoomHub(async (roomId) => {
    const room = await findRoomById(roomId);
    return room ? { roomId: room.roomId, mode: room.mode } : undefined;
  });

  const server = createServer(async (request, response) => {
    if (await handleApi(request, response, hub)) {
      return;
    }

    if (isHealthRequest(request)) {
      setCors(response);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (process.env.NODE_ENV === "production") {
      await serveStaticClient(request, response);
      return;
    }

    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("Multiplayer sync server is running. Open the Vite client on port 5173.");
  });

  server.on("upgrade", (request, socket) => {
    const url = requestUrl(request);
    if (url.pathname !== "/room" && url.pathname !== "/api/room") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const ws = upgradeToWebSocket(request, socket);
    if (ws) {
      hub.attach(ws);
    }
  });

  return server;
}

function isHealthRequest(request: IncomingMessage): boolean {
  return requestUrl(request).pathname === "/health";
}

async function serveStaticClient(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = requestUrl(request);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const candidate = resolve(join(CLIENT_DIST, pathname));

  if (!candidate.startsWith(CLIENT_DIST)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(candidate);
    response.writeHead(200, {
      "content-type": contentTypes[extname(candidate)] ?? "application/octet-stream",
    });
    response.end(file);
  } catch {
    const index = await readFile(join(CLIENT_DIST, "index.html"));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(index);
  }
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
}
