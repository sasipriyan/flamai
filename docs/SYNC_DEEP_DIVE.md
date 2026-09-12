# Real-Time Sync Deep Dive

## 1. Core Idea

The sync system is based on one simple rule:

```text
MongoDB stores room metadata.
The WebSocket server manages live room state.
The browser renders live actions.
```

The database is not used for every cursor movement because that would be slow, expensive, and unnecessary for ephemeral real-time state. The server keeps connected sessions in memory and broadcasts validated actions to the other participants in the same room.

## 2. Connection Sequence

```text
Dashboard
  |
  | GET /api/rooms
  v
Server API
  |
  | find rooms in MongoDB
  v
Dashboard room list

User creates or selects room
  |
  | username dialog
  v
Room screen
  |
  | WebSocket upgrade /room
  v
Raw WebSocket server
  |
  | join message
  v
RoomHub validates MongoDB room
  |
  | welcome + presence
  v
All connected clients
```

The WebSocket is opened only after the app knows three things:

- the room id
- the room mode
- the user's display name

That is why presence can show actual current user names.

## 3. REST Room API

Room creation and listing use normal HTTP endpoints.

### `GET /api/rooms`

Returns saved rooms from MongoDB plus live active user names from memory.

The dashboard uses this endpoint every few seconds while the user is not inside a room. This keeps the active user names fresh without needing a dashboard WebSocket.

### `POST /api/rooms`

Creates a new room.

The request body contains:

```json
{
  "name": "Design Review",
  "mode": "drawing"
}
```

The server validates:

- room name exists
- room name has at least 3 characters
- mode is exactly `emoji` or `drawing`

Then it creates a readable unique id like:

```text
design-review-a1b2c3d4
```

The room is saved in MongoDB and returned to the client.

## 4. WebSocket Upgrade

The browser connects to:

```text
ws://localhost:8090/room
```

The server receives a normal HTTP request with upgrade headers. `server/src/server.ts` only accepts upgrades for `/room`. Other upgrade paths are rejected.

`server/src/websocket.ts` completes the WebSocket handshake:

1. Read the `Sec-WebSocket-Key` request header.
2. Append the WebSocket GUID.
3. SHA-1 hash the result.
4. Base64 encode the hash.
5. Return `101 Switching Protocols` with `Sec-WebSocket-Accept`.

After this, the TCP socket is treated as a WebSocket stream.

## 5. Raw Frame Handling

The custom `RawWebSocket` class handles the frame details that browsers expect:

- text frames for JSON messages
- ping frames
- pong frames
- close frames
- masked frames from browser clients
- unmasked frames from the server
- payload lengths below 126 bytes
- extended 16-bit payload lengths
- extended 64-bit payload lengths
- maximum frame size protection

Client frames must be masked according to the WebSocket protocol. If an unmasked client frame arrives, the server closes the socket with a protocol error.

Fragmented frames are not supported because the app only sends small JSON messages. If a fragmented frame arrives, the server closes it as unsupported.

## 6. Join Message

After the socket opens, the client sends:

```json
{
  "kind": "join",
  "roomId": "design-review-a1b2c3d4",
  "clientId": "7c87cc4d-3fb2-4f0e-a2e9-1b9a70c18856",
  "name": "Sasi",
  "color": "#63e6be",
  "mode": "drawing"
}
```

The server validates the shape, then checks MongoDB for that `roomId`.

If the room exists:

- the server creates or reuses the live room object in memory
- the persisted room mode wins
- the session is stored by `clientId`
- a `welcome` message is sent to the joining client
- a `presence` event is broadcast to other users

If the room does not exist:

```json
{
  "kind": "error",
  "code": "room-not-found",
  "message": "Create the room before joining it."
}
```

## 7. Welcome Message

The `welcome` message gives the new client the current room state:

```json
{
  "kind": "welcome",
  "roomId": "design-review-a1b2c3d4",
  "clientId": "7c87cc4d-3fb2-4f0e-a2e9-1b9a70c18856",
  "mode": "drawing",
  "serverTime": 1799560000000,
  "participants": []
}
```

The important part is `participants`. Late joiners receive the current active users and their latest known cursor snapshots. This means they do not join an empty-looking room when other users are already inside.

## 8. Presence Sync

Presence messages look like this:

```json
{
  "kind": "presence",
  "event": "join",
  "participant": {
    "clientId": "abc",
    "name": "Sasi",
    "color": "#63e6be",
    "lastSeen": 1799560000000
  }
}
```

Supported presence events:

- `join`
- `leave`
- `update`

The client keeps participants in a `Map` keyed by `clientId`. If the event is `leave`, it removes that participant. For `join` and `update`, it inserts or replaces that participant snapshot.

## 9. Cursor Sync Pipeline

Cursor sync travels through these steps:

```text
pointermove
  -> normalize x/y
  -> store latest local cursor
  -> throttle outgoing packet
  -> send cursor message
  -> server validates
  -> server checks sequence number
  -> server stores latest cursor snapshot
  -> server broadcasts to other participants
  -> remote clients add sample to CursorTrack
  -> renderer interpolates and draws
```

Cursor packet:

```json
{
  "kind": "cursor",
  "seq": 42,
  "t": 5128.75,
  "x": 0.44,
  "y": 0.62
}
```

`x` and `y` are normalized coordinates between `0` and `1`.

The server broadcasts:

```json
{
  "kind": "cursor",
  "clientId": "abc",
  "seq": 42,
  "t": 5128.75,
  "serverTime": 1799560000000,
  "x": 0.44,
  "y": 0.62
}
```

The sender is excluded from the broadcast because the sender already renders its own cursor locally.

## 10. Cursor Throttling

Pointer events can be too frequent. If every movement event becomes a WebSocket message, the app wastes bandwidth and may overload low-end devices.

The client uses:

```text
CURSOR_SEND_INTERVAL_MS = 33
```

That means one client sends at most about:

```text
1000ms / 33ms = about 30 cursor messages per second
```

The client keeps the newest cursor position. If multiple pointer events happen inside the same 33ms window, older unsent positions are replaced by the newest one.

This gives a good tradeoff:

- movement still feels live
- bandwidth remains predictable
- server fan-out stays controlled

## 11. Sequence Numbers

Each action has a monotonically increasing `seq` number.

Example:

```text
cursor seq 1
cursor seq 2
reaction seq 3
draw seq 4
cursor seq 5
```

The server stores `lastSeq` for each connected session.

If a new message has:

```text
message.seq <= session.lastSeq
```

the server rejects it:

```json
{
  "kind": "error",
  "code": "stale-sequence",
  "message": "Dropped stale sequence 12; latest is 14."
}
```

This protects the room from stale replay and out-of-date actions after reconnects or delayed sends.

## 12. Interpolation

Remote cursors are not drawn directly at the newest packet. Direct drawing would create visible snapping because network packets arrive unevenly.

Each remote user gets a `CursorTrack`.

The track stores recent samples:

```text
[
  { x: 0.10, y: 0.20, t: 1000, seq: 1 },
  { x: 0.15, y: 0.22, t: 1033, seq: 2 },
  { x: 0.20, y: 0.25, t: 1066, seq: 3 }
]
```

The renderer draws at:

```text
renderTime = now - 100ms
```

This 100ms buffer usually gives the renderer two samples around the desired time. It can then linearly interpolate:

```text
ratio = (renderTime - before.t) / (after.t - before.t)
x = before.x + (after.x - before.x) * ratio
y = before.y + (after.y - before.y) * ratio
```

If the render time is slightly beyond the latest sample, the client extrapolates from the last two samples for a short bounded time. Extrapolation is capped at 180ms so a cursor does not keep drifting forever after packets stop.

## 13. Drawing Sync Pipeline

Drawing rooms use `draw` messages.

Pointer down:

```text
create stroke id
add first local point
send draw batch
```

Pointer move:

```text
if pointer moved enough:
  append local point
  queue point for network
```

Pointer up:

```text
send final draw message with done: true
release pointer capture
```

Draw packet:

```json
{
  "kind": "draw",
  "id": "stroke-7c87cc4d",
  "seq": 18,
  "t": 7032.45,
  "points": [
    { "x": 0.41, "y": 0.53 },
    { "x": 0.42, "y": 0.54 }
  ],
  "done": false
}
```

The client batches drawing points to reduce packet count. The server also validates that a draw packet has a safe number of points.

## 14. Reaction Sync Pipeline

Emoji rooms use `reaction` messages.

Reaction packet:

```json
{
  "kind": "reaction",
  "id": "9f4c1b9a",
  "seq": 21,
  "t": 8211.3,
  "x": 0.7,
  "y": 0.4,
  "emoji": "fire"
}
```

The actual app can render a visual emoji from the selected reaction list. The sync protocol only needs an action payload that tells clients what to draw and where to draw it.

## 15. Heartbeat And Cleanup

There are two cleanup layers.

### Browser Cleanup

When the page unloads, the client sends:

```json
{
  "kind": "leave"
}
```

This gives fast presence updates during normal tab close, refresh, or leaving the room.

### Server Cleanup

The server also checks for dead clients.

Constants:

```text
HEARTBEAT_INTERVAL_MS = 5000
ROOM_SWEEP_INTERVAL_MS = 3000
STALE_SESSION_MS = 8000
```

Each session has an `alive` flag. The server sends WebSocket ping frames. When a pong returns, the session is marked alive and `lastSeen` is updated.

If a client stops responding, the server closes it and removes it from the room.

## 16. Reconnect Behavior

If the socket closes unexpectedly:

```text
250ms
500ms
1000ms
2000ms
4000ms max
```

The client reconnects with exponential backoff.

The browser page keeps the same in-memory `clientId`, so the server can replace the older socket if both are present. This prevents the same browser tab from appearing as duplicate active users during reconnect.

## 17. Why Dashboard Active Users Can Be Correct

The dashboard does not guess active users from MongoDB. MongoDB only says which rooms exist.

For each saved room, the API asks the live `RoomHub`:

```text
hub.getActiveUsers(room.roomId)
```

That returns only participants currently tracked in server memory. This is why the dashboard can show names like `Sasi` and not fake viewer counts.

If old duplicate users appear, the cleanup paths are:

- normal `leave`
- WebSocket close
- heartbeat timeout
- stale session sweep
- replacement by same `clientId`

## 18. Scaling Discussion

The current version is intentionally single-process. That is acceptable for the assignment and makes the sync logic easy to inspect.

For production horizontal scaling, the next step would be:

- route all users in the same room to the same server process with sticky sessions, or
- publish room events through Redis/NATS and let multiple processes subscribe

Presence would also need shared TTL leases, because active users would no longer live in only one process.

The current message protocol is already compatible with that future because room ids, client ids, sequence numbers, and action types are explicit.
