# FLAM AI Real-Time Multiplayer Project Explanation

## 1. Short Summary

This project is a real-time multiplayer room application built for the FLAM AI frontend R&D assignment. Users open a dashboard, create a room, choose whether the room is for emoji taps or drawing, enter a display name, and then join a shared real-time canvas.

Inside a room, every connected user can see the current participants, remote cursor movement, network round-trip time, and shared actions. Emoji rooms broadcast click reactions. Drawing rooms broadcast stroke points while the user drags on the canvas.

The important technical point is that the sync layer is implemented with raw WebSockets. The server uses Node's built-in HTTP upgrade mechanism and a custom WebSocket frame implementation instead of Socket.IO, `ws`, Firebase, Liveblocks, Yjs, or another hosted real-time platform.

## 2. What The Final Application Does

The app has a dashboard-first flow:

- `/dashboard` shows all rooms saved in MongoDB.
- `/room/:roomId` opens a specific room.
- `/login` and `/register` redirect to `/dashboard` because the final requested flow does not use accounts.
- Users are asked for a username only when entering a room.
- No default room is created automatically.
- A user must create a room from the dashboard before anyone can join it.
- Each room has one fixed mode: `emoji` or `drawing`.
- The dashboard shows existing rooms and the names of active users currently inside each room.

Inside a room:

- The local cursor is rendered immediately.
- Remote cursors are rendered smoothly using interpolation.
- Presence updates show who joined, left, or reconnected.
- Emoji mode lets users choose a reaction and click/tap the canvas.
- Drawing mode lets users drag on the canvas and sync strokes to other users.
- The right-side panel shows status, room information, active users, buffer delay, round-trip time, and room actions.
- The layout is responsive for desktop and smaller screens.

## 3. Requirement Mapping

| Requirement | Implementation |
| --- | --- |
| Real-time multiplayer cursor/state sync | Cursor, reaction, drawing, and presence messages are sent over a WebSocket room connection. |
| Multiple users in one room | Each browser tab gets a unique client id and joins the same room id. |
| Raw WebSocket API | Client uses browser `WebSocket`; server implements WebSocket upgrade and frame parsing manually. |
| Smooth remote cursors | Client buffers samples and renders remote cursors 100ms behind real time. |
| Bandwidth control | Cursor messages are throttled to about 30 messages per second. Drawing points are batched. |
| Ordering / stale message handling | Every action has a per-client sequence number; server rejects stale sequence numbers. |
| Disconnect handling | Client sends `leave` on page hide. Server also removes stale clients with heartbeat and inactivity cleanup. |
| Reconnect handling | Client reconnects with exponential backoff and rejoins with the same client id. |
| Presence status | Server broadcasts `presence` messages and dashboard reads active user names from the running room hub. |
| Room creation | REST API creates room records in MongoDB. |
| Room modes | Room creation asks for `emoji` or `drawing`; server stores and enforces the persisted room mode. |
| Modular architecture | UI, routing, API, protocol, connection, rendering, interpolation, database, and room logic are split into separate files. |
| Validation | Server validates all incoming messages at runtime before using them. |
| Testing | Protocol parser tests cover valid and invalid messages. |

## 4. High-Level Architecture

```text
Browser Client
  |
  | REST: GET /api/rooms, POST /api/rooms
  v
Node HTTP Server
  |
  | MongoDB driver
  v
MongoDB Atlas

Browser Client
  |
  | Raw WebSocket: ws://localhost:8090/room
  v
Node RoomHub
  |
  | in-memory rooms, sessions, presence, latest cursors
  v
Other connected clients
```

The app deliberately separates persisted data from live sync data.

MongoDB stores durable room metadata:

- `roomId`
- room display name
- room mode
- creator label
- creation/update timestamps

The server memory stores live session state:

- connected sockets
- active participants
- latest participant cursor
- last accepted sequence number
- room presence

The browser stores visual-only state:

- local identity
- selected reaction
- local cursor
- remote cursor tracks
- active reactions
- active drawing strokes

This design keeps the real-time loop fast. Cursor and drawing packets do not need a database write on every movement.

## 5. User Flow

### Step 1: Open The Dashboard

The user opens:

```text
http://localhost:5173/dashboard
```

The dashboard calls:

```text
GET http://localhost:8090/api/rooms
```

The server loads saved rooms from MongoDB and adds active users from the current `RoomHub`.

### Step 2: Create A Room

The user enters a room name and selects one of two modes:

- Emoji taps
- Drawing

The client sends:

```text
POST http://localhost:8090/api/rooms
```

The server validates the input, generates a readable unique `roomId`, saves the room in MongoDB, and returns the created room.

### Step 3: Enter Username

When the user chooses a room, the app opens a username dialog. The WebSocket connection is not started until the user submits a valid name.

This is why the active user list shows human names instead of random anonymous viewers.

### Step 4: Join WebSocket Room

The client opens:

```text
ws://localhost:8090/room
```

Immediately after the WebSocket opens, the client sends a `join` message:

```json
{
  "kind": "join",
  "roomId": "design-review-abc12345",
  "clientId": "client-generated-id",
  "name": "Sasi",
  "color": "#63e6be",
  "mode": "drawing"
}
```

The server verifies the room exists in MongoDB. If the room does not exist, it rejects the join with a `room-not-found` error.

### Step 5: Sync Actions

Once joined, the client can send:

- `cursor` for pointer movement
- `reaction` for emoji taps
- `draw` for drawing strokes
- `ping` for round-trip time measurement
- `leave` for clean exit

The server validates each message and broadcasts it to every other participant in the same room.

## 6. Why Raw WebSocket Was Used

The assignment focuses on real-time synchronization fundamentals. Using raw WebSockets makes those fundamentals visible:

- the HTTP upgrade handshake
- WebSocket frame encoding and decoding
- masked client frames
- text frames
- ping/pong
- close frames
- message validation
- presence state
- sequence numbers
- throttling
- interpolation

Libraries like Socket.IO are excellent for production features, but they hide many of these low-level details. This implementation shows that the underlying protocol and synchronization behavior are understood.

## 7. How Cursor Sync Works

The browser listens to pointer movement over the canvas. Pointer positions are converted from pixel coordinates to normalized coordinates:

```text
x = pointerX / canvasWidth
y = pointerY / canvasHeight
```

The values are clamped between `0` and `1`.

Normalized coordinates are important because each user may have a different screen size. A cursor at `x = 0.5, y = 0.5` means "center of the shared surface" on every device.

The client does not send every pointer event. Browser pointer events can fire 60 to 120 times per second. Instead, `connection.ts` keeps the newest pointer position and flushes at most once every 33ms, which is about 30Hz.

Every cursor packet includes:

- `seq`: increasing sequence number
- `t`: client timestamp
- `x`: normalized x
- `y`: normalized y

The server checks that the sequence number is newer than the last accepted message from that client. If the message is stale, the server drops it.

Remote clients store cursor samples in `CursorTrack`. The renderer draws remote cursors slightly behind real time with a 100ms buffer. This makes remote movement smooth even if packets arrive unevenly.

## 8. How Drawing Sync Works

Drawing mode uses the same room transport but sends `draw` messages instead of emoji reactions.

When the pointer goes down:

- the client creates a unique stroke id
- the local stroke appears immediately
- the first point is sent to the server

When the pointer moves:

- the client adds points only when the pointer moved enough
- points are batched to avoid one packet per movement event
- batches are flushed at the cursor interval or when enough points collect

When the pointer goes up:

- the final draw packet is sent with `done: true`
- remote clients mark that stroke complete

This gives a responsive local drawing experience and still keeps network usage controlled.

## 9. How Emoji Sync Works

Emoji rooms treat clicks/taps as discrete actions.

When the user clicks the canvas:

- the local reaction appears instantly
- the client sends a `reaction` message to the server
- the server validates it
- all other room participants receive the reaction
- remote clients render the reaction animation at the normalized location

Reactions are not stored in MongoDB because they are short-lived visual events.

## 10. How Presence Works

Presence is owned by the server because the server knows which WebSocket sessions are actually connected.

On join:

- the server stores the participant by `clientId`
- sends `welcome` to the new user with the full participant snapshot
- broadcasts `presence: join` to the rest of the room

On leave:

- the browser sends a `leave` message during cleanup/page hide
- the server removes the participant
- the server broadcasts `presence: leave`

On reconnect:

- the client reuses the same in-page `clientId`
- the server replaces the older socket if it still exists
- the room shows one user instead of duplicates

On crashed/closed tabs:

- server heartbeat and stale-session cleanup remove clients that stop responding

The dashboard uses `RoomHub.getActiveUsers(roomId)` to show the active names for each saved room.

## 11. Demo Script For The Company

Use this exact flow in a demo:

1. Run `npm install`.
2. Create `server/.env` from `server/.env.example` and add the MongoDB password locally.
3. Run `npm run dev`.
4. Open `http://localhost:5173/dashboard`.
5. Create a room called something like `Company Demo`.
6. Choose `Emoji taps` first.
7. Enter a username and join.
8. Open the same room in 2-4 more tabs using `Open tab` or `Copy link`.
9. Enter different usernames in each tab.
10. Move cursors around and show smooth remote cursor movement.
11. Click the canvas and show emoji reactions syncing.
12. Go back to dashboard and create a `Drawing` room.
13. Join multiple tabs and drag on the canvas to show live stroke sync.
14. Close one tab and show the presence list updating.
15. Point out the RTT metric and active user list.

## 12. Important Design Decisions

### MongoDB Is Used Only For Durable Rooms

Room records are persisted in MongoDB, so `MONGODB_URI` is required. Cursor positions, reactions, and drawing strokes are live collaboration events and are not persisted in this version.

### The Server Is The Room Authority

The server decides whether a room exists, who is currently active, which mode the room uses, and whether a message is valid.

### The Client Renders Locally First

For local cursor, emoji, and drawing, the client updates the screen immediately. This makes the interface feel instant. Other clients receive the event through the server.

### Normalized Coordinates Make The Room Responsive

The sync protocol does not care about exact screen pixels. It sends percentages across the shared surface. Each client maps those percentages back to its own canvas size.

### Interpolation Improves Perceived Quality

Network packets do not arrive perfectly evenly. Instead of drawing each packet as a jump, the client keeps a tiny buffer and renders between known samples.

## 13. Current Limitations

These are honest limitations that can be explained as future work:

- Room access is link-based; there is no password or invite permission system.
- Drawing strokes are live only and are not persisted after a server restart.
- Reactions are short-lived and not replayed to late joiners.
- The app currently runs as a single Node process.
- Horizontal scaling would need sticky sessions or a pub/sub layer like Redis/NATS.
- There is no rate-limit UI if a client becomes overloaded.

## 14. How To Explain The Project In One Paragraph

I built a modular real-time multiplayer room application using React, TypeScript, Node, MongoDB, and raw WebSockets. Users create MongoDB-backed rooms from a dashboard, choose either emoji or drawing mode, enter a username, and join a shared canvas. The server validates WebSocket messages, manages presence, enforces room modes, rejects stale sequence numbers, and broadcasts cursor, reaction, and drawing updates. The client throttles outgoing cursor traffic, batches drawing points, renders local actions immediately, and smooths remote cursors with interpolation and bounded extrapolation. The result demonstrates low-level real-time sync fundamentals without relying on Socket.IO or hosted collaboration providers.
