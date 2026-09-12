# Real-Time Multiplayer Cursor/State Sync

A raw WebSocket multiplayer demo for FLAM AI's frontend R&D assignment. Multiple browser tabs join the same room, see each other's cursors move smoothly, and broadcast click reactions.

## Detailed Explanation Docs

For company submission and interview explanation, use these documents:

- [Company explanation guide](docs/COMPANY_EXPLANATION.md): what was built, requirement mapping, demo flow, and design decisions.
- [Real-time sync deep dive](docs/SYNC_DEEP_DIVE.md): WebSocket join flow, presence, cursor sync, interpolation, drawing sync, reactions, cleanup, and scaling.
- [File-by-file implementation guide](docs/FILE_BY_FILE_GUIDE.md): what every important project file does and how the code works together.
- [Interview Q&A](docs/INTERVIEW_QA.md): short answers for likely technical questions.
- [Vercel deployment guide](docs/VERCEL_DEPLOYMENT.md): Vercel hosting setup, WebSocket notes, and required MongoDB environment variables.

## What Works

- MongoDB-backed room storage. `MONGODB_URI` is required because room records are not saved locally.
- Dashboard-first flow with no login or register page.
- Username prompt before entering each room.
- Existing room list with live active user names.
- Raw browser `WebSocket` client.
- Raw Node `http` upgrade server with a small, dependency-free WebSocket frame implementation.
- Room presence with join, leave, reconnect replacement, and current cursor snapshots for late joiners.
- Throttled cursor sending at roughly 30Hz instead of blasting every pointer event.
- Remote cursor interpolation with a 100ms render buffer and bounded short extrapolation.
- Sequence-number based stale-message rejection on the server and client.
- Runtime validation for all client-to-server messages.
- Emoji reactions broadcast to other participants.
- Optional drawing rooms where users drag to sync stroke segments.
- Server heartbeat cleanup using WebSocket ping/pong.

## Setup

Install dependencies:

```bash
npm install
```

Create a backend `.env` file from `server/.env.example`:

```bash
copy server\.env.example server\.env
```

Fill in the MongoDB password:

```text
MONGODB_URI=mongodb+srv://SASI:<your_real_password>@hackathon.iyreas2.mongodb.net/?appName=Hackathon
MONGODB_DB=flamai
```

Run the development server and client together:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

If that port is busy, Vite prints the next available local URL.

Main client routes:

- `/dashboard`
- `/room/:roomId`

Open the dashboard first. Create a room by choosing a room name and mode. There is no default room creation.

When entering any room, the app asks for a username. Open the same room in 3-5 tabs or devices on the same network, enter different names, and move the pointer over the canvas to send cursor updates. Emoji rooms use clicks for reactions; drawing rooms use drag gestures for synchronized strokes.

When joining a new room, choose the room activity:

- `Emoji taps`: click the canvas to emit the selected emoji burst.
- `Drawing`: drag on the canvas to draw synchronized strokes.

The first user to create a room sets the mode. Later users who join the same room inherit that room's mode.

The side panel also has:

- `Open tab` to open another client in the same room.
- `Copy link` to copy the current room URL.
- `RTT` to show an app-level round-trip latency probe.

Room links use `/room/:roomId` and ask for a username before connecting when the room still exists.

The lobby shows all persisted MongoDB rooms with the current active users in each room.

The WebSocket endpoint is:

```text
ws://localhost:8090/room
```

## Validation

```bash
npm test
npm run typecheck
npm run build
```

## Modular Structure

- `client/src/App.tsx`: route coordinator for dashboard, username dialog, and room screen.
- `client/src/components/Lobby.tsx`: dashboard UI, room creation, room list, active users.
- `client/src/components/NameDialog.tsx`: asks for a username before opening WebSocket.
- `client/src/components/MultiplayerRoom.tsx`: realtime room UI, cursor/drawing/reaction events, metrics, presence.
- `client/src/connection.ts`: browser WebSocket wrapper with reconnect, throttling, ping, and event subscriptions.
- `client/src/render.ts`: canvas drawing loop for grid, cursors, reactions, and strokes.
- `client/src/interpolation.ts`: smooth remote cursor interpolation logic.
- `client/src/routes.ts`: `/dashboard` and `/room/:roomId` URL helpers.
- `server/src/server.ts`: HTTP server, static serving, and WebSocket upgrade.
- `server/src/websocket.ts`: raw WebSocket handshake and frames.
- `server/src/api.ts`: room list/create REST endpoints.
- `server/src/room.ts`: active room membership, presence, broadcast, cleanup.
- `server/src/protocol.ts`: server-side message types and validation.
- `server/.env.example`: backend environment variable template for MongoDB.
- `server/src/db.ts`: MongoDB room collection access.

## Protocol Design

Client to server messages:

```ts
type ClientToServerMessage =
  | {
      kind: "join";
      roomId: string;
      clientId: string;
      name: string;
      color: string;
      mode: "emoji" | "drawing";
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
      points: Array<{ x: number; y: number }>;
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
```

Server to client messages:

```ts
type ServerToClientMessage =
  | {
      kind: "welcome";
      roomId: string;
      clientId: string;
      mode: "emoji" | "drawing";
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
      clientId: string;
      seq: number;
      t: number;
      serverTime: number;
      x: number;
      y: number;
    }
  | {
      kind: "reaction";
      clientId: string;
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
      clientId: string;
      id: string;
      seq: number;
      t: number;
      serverTime: number;
      points: Array<{ x: number; y: number }>;
      done: boolean;
    }
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
```

Coordinates are normalized from `0` to `1`, so the same protocol works across different viewport sizes. Server validation rejects unknown message kinds, malformed JSON, invalid ids, invalid colors, invalid coordinates, missing names, and stale sequence numbers.

Rooms are stored in MongoDB. A WebSocket join is accepted only when the room already exists in MongoDB and the client supplies a valid display name.

## Throttling

The client keeps the latest pointer position and flushes cursor messages at most once every 33ms, roughly 30 messages per second per active client. This is responsive enough for a live cursor while cutting traffic far below raw `pointermove` frequency, which can be 60-120Hz.

Reactions are discrete, user-triggered actions and are sent immediately.

Drawing rooms batch stroke points into small `draw` messages, capped at 12 points per packet. The client flushes drawing batches at the same cadence as cursor updates or sooner when a stroke ends.

The client sends a lightweight `ping` every 2 seconds after connecting. The server immediately replies with `pong`, and the client displays the measured round-trip time. This is diagnostic only; it does not affect cursor smoothing.

## Interpolation Strategy

Remote cursors are not drawn directly at the newest received packet. Each remote client has a small `CursorTrack` buffer capped at 8 samples. The renderer draws at `now - 100ms`, which usually gives it two nearby samples to interpolate between.

Tradeoff:

- Added latency: about 100ms for remote cursors.
- Benefit: much smoother movement under irregular packet arrival.
- If the render time moves past the latest sample, the client extrapolates briefly from the last two samples for up to 180ms, then clamps to the shared surface.
- Tracks are bounded, so a long session does not accumulate unbounded cursor history.

## Disconnect And Reconnect

The client sends an explicit `leave` message on page close, reload, and normal room cleanup so other tabs update quickly. The server also expires clients that stop sending app-level messages for about 8 seconds, which covers browser exits that do not flush their final packet. Transport-level WebSocket ping/pong runs every 5 seconds as a second cleanup path.

The client creates an in-memory `clientId` for each page load. When the connection drops without a reload, it reconnects with exponential backoff and rejoins with the same id. If the server already has an older connection for that id, it replaces the old socket instead of showing duplicate cursors. New tabs get their own ids, so testing 3-5 tabs shows 3-5 active participants.

## Ordering

Every cursor and reaction carries a monotonically increasing `seq` number per client. The server stores each session's latest sequence and rejects any action with a sequence less than or equal to the latest accepted one. The client also discards stale remote cursor samples before adding them to its interpolation buffer.

WebSocket preserves order on a single connection, but reconnects, retries, and real network behavior can still produce stale application-level updates. Sequence checks make the intended behavior explicit.

## Server State

The server keeps only active room state:

- connected sessions
- participant name/color metadata
- latest cursor snapshot per participant
- latest sequence number per connected session

It does not persist live cursor/reaction/drawing data to disk and does not replay historical reactions. Late joiners receive the current participant list and latest known cursor positions in the `welcome` snapshot.

## Known Limitations

- No room-level access control; anyone with the dashboard or room link can enter with a display name.
- `MONGODB_URI` is required for room creation and room listing.
- Draw strokes and reactions are not persisted across server restarts.
- No horizontal scaling implementation.
- No binary protocol or compression.
- No backpressure UI for overloaded clients.
- Reactions are fire-and-forget and are not included in join snapshots.

## Time Spent

Approximate build time: 5-7 hours for implementation, validation, and documentation.

## AI Tool Disclosure

I used OpenAI Codex to help implement the project, organize the architecture, write documentation, and run validation commands. The final code is intentionally small and should be explainable line by line in an interview.
