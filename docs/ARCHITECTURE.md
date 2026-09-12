# Architecture

## Overview

The project is split into a minimal server and a React client:

```text
server/src/server.ts       HTTP server, static serving, WebSocket upgrade route
server/src/websocket.ts    Raw WebSocket handshake, frame parsing, text/ping/close frames
server/src/protocol.ts     Message types and runtime validation
server/src/room.ts         Room membership, presence, broadcast, heartbeat cleanup
server/src/api.ts          Room list and room creation REST API
server/src/db.ts           MongoDB room collection access

client/src/api.ts          Room REST client
client/src/routes.ts       Browser History route helpers
client/src/constants.ts    Shared color and reaction constants
client/src/appTypes.ts     UI-only shared TypeScript types
client/src/App.tsx         Route coordinator and top-level app state
client/src/components/Lobby.tsx Dashboard, room creation, and room list
client/src/components/NameDialog.tsx Username prompt before room entry
client/src/components/MultiplayerRoom.tsx Realtime room screen and canvas controls
client/src/components/StatusPill.tsx Small connection-state display component
client/src/connection.ts   Framework-agnostic room API and reconnect logic
client/src/interpolation.ts Remote cursor sample buffering and smoothing
client/src/render.ts       Canvas drawing loop
client/src/protocol.ts     Client-side server-message parsing and shared message types
```

The transport, API, protocol, room state, interpolation, and rendering are separated so new actions can be added without rewriting the WebSocket framing code.

## File Responsibilities

`App.tsx` is intentionally small. It listens to browser route changes, loads the MongoDB-backed room list, decides when to show the dashboard, username dialog, or active room, and passes callbacks down to child components.

`Lobby.tsx` owns only the dashboard UI. It renders existing rooms, active user names, room mode badges, and the create-room form.

`NameDialog.tsx` owns the pre-join username step. The WebSocket is not opened until this form submits a valid display name.

`MultiplayerRoom.tsx` owns the live room experience: joining the raw WebSocket room, pointer events, emoji taps, drawing strokes, metrics, and presence display.

`connection.ts` wraps browser `WebSocket` behavior behind a small API: connect, reconnect, send cursor, send reaction, send draw, subscribe to presence, subscribe to latency, and close.

`render.ts` is canvas-only. It receives a scene snapshot and draws the grid, cursors, labels, emoji bursts, and drawing strokes.

`interpolation.ts` is math-only. It stores recent cursor samples and returns a smoothed remote cursor position for the renderer.

`protocol.ts` defines the message contract. The server version validates client input; the client version validates server input before the UI uses it.

Client routing is handled with the browser History API:

- `/dashboard`
- `/room/:roomId`

The root, `/login`, and `/register` route aliases redirect to `/dashboard` because the current product flow does not use accounts. Direct room links open `/room/:roomId` and show the username dialog before a WebSocket join starts.

## Room Storage And Usernames

Rooms are stored in MongoDB through `server/src/db.ts`. A room has a generated `roomId`, display name, creation time, and mode: `emoji` or `drawing`. The dashboard reads persisted rooms from MongoDB and combines them with the server's in-memory active-user list.

No default room is created. Before entering a room, the client asks for a display name and sends that name in the WebSocket `join` message. Those names are what the dashboard and room presence views show as active users.

## Transport

The server uses Node's built-in `http` server and handles the `/room` upgrade manually. `server/src/websocket.ts` implements only the frame support this assignment needs:

- text frames
- close frames
- ping/pong frames
- unfragmented masked client frames
- unmasked server frames
- bounded frame size

This keeps the transport honest while avoiding Socket.IO, `ws`, or a hosted realtime provider.

## Room Lifecycle

1. Client opens `ws://localhost:8090/room`.
2. Client sends a `join` message with room id, stable client id, display name, color, and requested mode.
3. Server validates the join message.
4. Server looks up the room in MongoDB and rejects joins for rooms that have not been created through the dashboard.
5. Server replaces any older connection with the same client id.
6. Server sends `welcome` to the joining client with all current participants, latest cursor snapshots, and the persisted room mode.
7. Server broadcasts a presence event to the rest of the room.

Cursor and reaction actions are broadcast to the room except to the sender. The sender renders its own cursor and reactions immediately, which avoids waiting for a round trip.

The persisted room record sets its activity mode: `emoji` or `drawing`. The selected mode is returned in `welcome`, and later clients inherit it instead of changing the room underneath existing participants.

## Sync Model

The server is authoritative for persisted room metadata, presence, room mode, basic message validity, and per-client ordering. It is not authoritative about physics or final application state because this demo only syncs ephemeral cursor/reaction/drawing actions.

For each connected client, the server stores the latest accepted sequence number. Any action with an older or equal sequence is rejected with an error message. This prevents stale replay after reconnect or delayed app-level sends.

## Bandwidth Control

The client does not send every pointer event. `connection.ts` keeps only the latest pointer position and flushes at most once every 33ms.

This gives each active client an upper bound of about 30 cursor packets per second. With 10 users, the server fan-out remains simple and predictable for the assignment scope.

Drawing rooms use the same cadence for stroke batches. Each `draw` packet carries up to 12 normalized points, so dragging does not create one network packet per pointer event.

The client also sends a lightweight `ping` every 2 seconds and displays the measured `pong` round-trip time. That metric is intentionally separate from interpolation so it can be discussed during network-throttling demos without changing the sync algorithm.

## Interpolation

Each remote participant owns a `CursorTrack`. The track stores at most 8 samples and draws with a fixed 100ms delay. Rendering slightly behind real time gives the client enough data to interpolate between samples instead of snapping to every packet.

When packets arrive irregularly and the renderer moves beyond the latest sample, the track briefly extrapolates from the last two samples for up to 180ms. This hides tiny gaps but avoids letting a cursor drift forever.

## Failure Handling

Malformed message:

- Server returns an `error` message.
- Server keeps the socket open for recoverable protocol mistakes.

Disconnected tab:

- Browser close or reload sends an explicit `leave` message when the page gets a `pagehide` event.
- Server removes the participant and broadcasts `presence: leave`.

Dropped network:

- Server expires sessions that stop sending app-level messages for about 8 seconds.
- Transport heartbeat also closes silent sockets within a bounded interval.
- Client reconnects with exponential backoff.

Reconnect:

- Client reuses its in-memory client id for network reconnects in the same page.
- Server replaces an older connection with the same id.
- Other clients see one participant, not duplicates.

## Scaling Discussion

This implementation targets correctness and smoothness for 3-10 clients on one Node process. For horizontal scaling, rooms would need consistent routing or shared pub/sub:

- sticky sessions by room id at the load balancer
- Redis, NATS, or another pub/sub bus for cross-process fan-out
- shared presence leases with TTLs
- a policy for reconnecting clients that land on another process

The current protocol can survive that transition because message shape and room membership are already explicit, but this assignment intentionally keeps the implementation single-process.
