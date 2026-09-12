# File-By-File Implementation Guide

This document explains what each important file does and how the code fits together. Use it when you need to explain the project in detail to an interviewer, evaluator, or company engineer.

## 1. Root Files

### `package.json`

This is the root workspace configuration.

Important parts:

- `workspaces`: includes `client` and `server`.
- `npm run dev`: starts both client and server through `scripts/dev.mjs`.
- `npm run build`: builds both workspaces.
- `npm run typecheck`: type-checks both workspaces.
- `npm test`: runs server-side tests.

The root file lets the project behave like one assignment even though frontend and backend are separated.

### `package-lock.json`

Locks dependency versions for reproducible installs. This helps the evaluator run the same dependency tree after `npm install`.

### `server/.env.example`

Documents the environment variables needed locally:

```text
MONGODB_URI=mongodb+srv://SASI:<db_password>@hackathon.iyreas2.mongodb.net/?appName=Hackathon
MONGODB_DB=flamai
```

The real password belongs only in `server/.env`. The example file intentionally uses a placeholder.

### `server/.env`

Local-only backend secret configuration. This file contains the actual MongoDB connection string on the developer machine and should not be committed or shared publicly.

### `.gitignore`

Keeps local/generated files out of version control:

- `node_modules`
- `server/.env`
- build outputs
- TypeScript build metadata

### `scripts/dev.mjs`

Starts the full development environment.

What it does:

- finds an available server port starting from `8090`
- starts the server workspace
- starts the client workspace
- passes `VITE_API_URL` and `VITE_WS_URL` to Vite

This fixed the earlier `EADDRINUSE` issue because the script can choose another server port when `8090` is already occupied.

### `README.md`

The main project entry point. It explains setup, available scripts, routes, protocol shape, throttling, interpolation, disconnect/reconnect behavior, and known limitations.

### `ARCHITECTURE.md`

The shorter technical architecture summary. It explains how the client, server, database, protocol, and sync loop are separated.

## 2. Client Files

### `client/package.json`

Defines frontend dependencies and scripts.

Main responsibilities:

- run Vite in development
- build the React app
- type-check the client code

### `client/index.html`

The browser entry HTML file used by Vite. It contains the root DOM element where React mounts the app.

### `client/vite.config.ts`

Vite configuration for the frontend. It controls how the React app is served and built.

### `client/tsconfig.json` and `client/tsconfig.app.json`

TypeScript configuration files for the frontend. They define compiler behavior, strictness, JSX support, module resolution, and included files.

### `client/src/main.tsx`

The frontend entry point.

Code responsibility:

- imports global CSS from `styles.css`
- imports the top-level `App`
- creates the React root
- renders the application into the page

This file stays tiny because app logic belongs in components and modules.

### `client/src/App.tsx`

This is the top-level route and state coordinator.

Important state:

- `route`: current browser route
- `rooms`: rooms loaded from the server
- `roomsError`: dashboard loading error
- `roomsLoading`: dashboard loading flag
- `activeRoom`: currently joined room
- `displayName`: username chosen by the user
- `joinDraft`: room pending username confirmation

Important logic:

- listens to `popstate` so back/forward browser navigation works
- redirects `/`, `/login`, and `/register` to `/dashboard`
- polls the room list every 3 seconds while on the dashboard
- detects direct room links like `/room/:roomId`
- opens the username dialog before entering a room
- renders `Lobby`, `NameDialog`, or `MultiplayerRoom`

Why it matters:

`App.tsx` keeps navigation decisions in one place. The dashboard does not need to know how routing works, and the room component does not need to know how rooms are loaded from MongoDB.

### `client/src/api.ts`

The REST API client for room operations.

Main exports:

- `RoomSummary`
- `getRooms()`
- `createStoredRoom(input)`

What `getRooms()` does:

- calls `GET /api/rooms`
- parses the JSON response
- returns the saved rooms plus active user data

What `createStoredRoom()` does:

- calls `POST /api/rooms`
- sends the room name and selected mode
- returns the created MongoDB-backed room

The base URL comes from `VITE_API_URL`. If it is not set, it falls back to `http://localhost:8090`.

### `client/src/routes.ts`

Small browser routing helper module.

Main functions:

- `currentRoute()`: returns the current path and query string
- `navigateTo(path, setRoute, replace?)`: updates browser history and React route state
- `getRoomIdFromPath(pathname)`: extracts room id from `/room/:roomId`
- `roomPath(roomId)`: builds `/room/:roomId`
- `isDashboardAlias(pathname)`: treats `/`, `/login`, and `/register` as dashboard routes

Why it matters:

The app gets clean URLs without adding a full routing library.

### `client/src/appTypes.ts`

Shared UI-only TypeScript types.

Examples:

- participant display objects
- local cursor state
- local user identity
- room join draft

These are not protocol types. They describe frontend state.

### `client/src/constants.ts`

Shared client constants.

It contains:

- available user colors
- available reaction options

Keeping constants in one module makes the UI easier to change without digging through multiple components.

### `client/src/protocol.ts`

Client-side protocol definitions.

It defines:

- client id type
- room id type
- room mode type
- server message types
- remote action types
- participant snapshots
- draw point type
- `parseServerMessage()`

`parseServerMessage()` is important because data arriving over a WebSocket is untrusted. Even though the server is our own code, the browser still checks message shape before the UI uses it.

### `client/src/connection.ts`

This is the browser WebSocket wrapper. It hides low-level WebSocket details from React components.

Main export:

```ts
createRoom(options): RoomConnection
```

The returned connection object provides:

- `sendCursor(x, y)`
- `sendReaction(x, y, emoji)`
- `sendDraw(id, points, done)`
- `onRemoteAction(listener)`
- `onPresence(listener)`
- `onMode(listener)`
- `onStatus(listener)`
- `onError(listener)`
- `onLatency(listener)`
- `close()`

Important internal behavior:

- opens a browser `WebSocket`
- sends a `join` message when the socket opens
- reconnects with exponential backoff
- throttles cursor sends to 33ms
- batches draw messages
- sends ping probes every 2 seconds
- sends `leave` on `pagehide`
- emits events to React through listener sets

Why it matters:

React components can work with a clean room connection API. They do not need to manually manage socket events, timers, reconnect attempts, or message parsing.

### `client/src/interpolation.ts`

Math-only module for smooth remote cursors.

Main class:

```ts
CursorTrack
```

Important behavior:

- stores a small list of recent cursor samples
- rejects stale samples by sequence number
- caps stored samples to avoid memory growth
- renders remote cursors with a 100ms delay
- interpolates between known samples
- extrapolates briefly when needed
- clamps output to the shared surface

Why it matters:

Network messages do not arrive at perfect intervals. Interpolation turns uneven network samples into visually smooth movement.

### `client/src/render.ts`

Canvas rendering module.

Main export:

```ts
startRenderer(canvas, getScene)
```

What it draws:

- background grid
- drawing strokes
- local cursor
- remote cursors
- cursor labels
- reactions

Important design:

- `requestAnimationFrame` drives the render loop
- canvas size is adjusted for device pixel ratio
- scene data is pulled from `getScene()`
- drawing code stays outside React rendering

Why it matters:

Real-time cursor rendering changes many times per second. Canvas is a good fit because it avoids forcing React to re-render the whole UI for every frame.

### `client/src/components/Lobby.tsx`

Dashboard UI component.

It owns:

- room name input
- mode selection
- create-room loading state
- create-room errors
- room list display
- active user pills
- enter-room buttons

It receives room data and callbacks from `App.tsx`, so it stays focused on presentation and dashboard interaction.

### `client/src/components/NameDialog.tsx`

Username prompt shown before entering a room.

It owns:

- local username input
- submit validation
- cancel/join buttons

Why it matters:

The app does not open a WebSocket until the username is known. This fixes fake/incorrect active viewer counts because the server receives real display names.

### `client/src/components/MultiplayerRoom.tsx`

The main real-time room component.

It owns:

- joining the WebSocket room
- current connection status
- current participant list
- selected emoji reaction
- drawing pointer state
- local cursor
- room stats
- error messages
- copy/open link actions

Important refs:

- `canvasRef`: the canvas DOM node
- `connectionRef`: active room connection
- `tracksRef`: remote cursor interpolation tracks
- `participantsRef`: latest participants for renderer
- `reactionsRef`: active reaction animations
- `strokesRef`: drawing strokes
- `localCursorRef`: local cursor position
- `drawingStrokeIdRef`: active local stroke id
- `lastDrawPointRef`: last accepted drawing point

Important pointer logic:

- `pointermove` updates local cursor and sends throttled cursor messages
- `pointerdown` starts drawing in drawing rooms
- `pointermove` during drawing appends stroke points
- `pointerup` sends the final drawing packet
- `click` sends emoji reactions in emoji rooms

Why it matters:

This is where UI interaction becomes real-time protocol messages.

### `client/src/components/StatusPill.tsx`

Small display component for connection state.

It maps internal states:

- `connecting`
- `open`
- `reconnecting`
- `closed`

to user-facing labels and styles.

### `client/src/styles.css`

Global styling for the app.

It styles:

- dashboard layout
- create-room controls
- room cards
- username dialog
- real-time room layout
- canvas stage
- right-side control panel
- mode tools
- reaction picker
- drawing tools
- metrics
- presence list
- responsive breakpoints

Why it matters:

The project uses a polished custom theme and responsive layout without relying on a UI component framework.

## 3. Server Files

### `server/package.json`

Defines backend scripts and dependencies.

Important scripts:

- `dev`: runs the TypeScript server with `tsx`
- `build`: compiles TypeScript
- `typecheck`: validates backend types
- `test`: runs Node tests

### `server/tsconfig.json`

TypeScript configuration for the backend. It controls module output, strict type checking, and included source files.

### `server/src/config.ts`

Loads environment configuration.

Responsibilities:

- loads `server/.env`
- reads `MONGODB_URI`
- reads `MONGODB_DB`
- exports a typed `config` object

The app uses `flamai` as the intended MongoDB database name.

### `server/src/db.ts`

MongoDB data access layer.

Important responsibilities:

- creates one lazy `MongoClient`
- selects the configured database
- exposes the `rooms` collection
- ensures indexes
- defines the `RoomDocument` type
- finds a room by `roomId`
- creates readable unique room ids

Important room fields:

- `roomId`
- `name`
- `mode`
- `createdBy`
- `createdByName`
- `createdAt`
- `updatedAt`

Why it matters:

Database code stays separate from HTTP and WebSocket code. This makes it easier to replace or expand persistence later.

### `server/src/api.ts`

REST API module for dashboard room operations.

Main export:

```ts
handleApi(req, res, hub)
```

Endpoints:

- `GET /api/rooms`
- `POST /api/rooms`
- `OPTIONS /api/*`

What `GET /api/rooms` does:

- loads room documents from MongoDB
- sorts newest rooms first
- limits the list
- asks `RoomHub` for active users per room
- returns JSON to the dashboard

What `POST /api/rooms` does:

- reads JSON body
- validates room name
- validates room mode
- creates a room document
- inserts it into MongoDB
- returns the created room

It also sets CORS headers so the Vite client can call the server during development.

### `server/src/server.ts`

The main backend entry point.

Responsibilities:

- creates the Node HTTP server
- handles `/health`
- delegates `/api/*` requests to `handleApi`
- serves built frontend files in production
- handles WebSocket upgrade requests
- creates the `RoomHub`
- connects room joins to MongoDB room lookup
- listens on the configured port

Important behavior:

- only `/room` is accepted as a WebSocket endpoint
- joins are resolved against MongoDB with `findRoomById`
- room mode comes from the persisted room record

### `server/src/websocket.ts`

Custom raw WebSocket implementation.

Main exports:

- `RawWebSocket`
- `upgradeToWebSocket(request, socket)`

`upgradeToWebSocket()`:

- validates upgrade headers
- calculates `Sec-WebSocket-Accept`
- writes the `101 Switching Protocols` response
- returns a `RawWebSocket`

`RawWebSocket`:

- reads chunks from the TCP socket
- parses WebSocket frames
- unmasks browser payloads
- emits text messages
- sends text frames
- sends ping frames
- responds to ping with pong
- emits pong events
- sends close frames
- enforces maximum frame size

Why it matters:

This file proves the project does not rely on a WebSocket server package. It implements the transport layer directly.

### `server/src/protocol.ts`

Server-side protocol contract and validation.

It defines:

- client-to-server message types
- server-to-client message types
- participant snapshot type
- draw point type
- room mode type
- error code type
- `parseClientMessage()`
- `encodeServerMessage()`

Validation checks include:

- JSON must parse
- message must be an object
- `kind` must be known
- room id and client id must be safe strings
- display name must be present and limited
- color must be a hex color
- mode must be `emoji` or `drawing`
- coordinates must be numbers from `0` to `1`
- reaction payload must be valid
- draw packets must include a safe number of points
- ping messages must include id and timestamp

Why it matters:

Anything from the browser can be tampered with. Runtime validation prevents malformed messages from corrupting room state.

### `server/src/room.ts`

The real-time room state manager.

Main classes:

- `RoomHub`
- `ClientSession`
- `Room`

`RoomHub` responsibilities:

- owns the map of active rooms
- accepts new WebSocket connections
- validates joins against MongoDB through `resolveRoom`
- routes messages to the correct room
- exposes active users for the dashboard API
- sweeps inactive/empty rooms

`ClientSession` responsibilities:

- wraps one raw WebSocket connection
- parses raw JSON messages
- sends JSON messages
- tracks `clientId`, name, color, and `lastSeq`
- runs heartbeat ping/pong
- closes dead sockets

`Room` responsibilities:

- stores sessions by `clientId`
- stores participant snapshots by `clientId`
- sends welcome snapshots
- broadcasts presence
- handles cursor, reaction, and draw actions
- rejects stale sequence numbers
- removes sessions on leave/disconnect
- exposes active users

This is the main server-side sync brain of the project.

### `server/src/protocol.test.ts`

Node test file for protocol validation.

It checks that:

- valid messages parse successfully
- invalid JSON is rejected
- invalid coordinates are rejected
- invalid/unknown message kinds are rejected

Why it matters:

The protocol parser is the boundary between untrusted client input and trusted server logic, so it deserves focused tests.

## 4. How Files Work Together

### Dashboard Flow

```text
App.tsx
  -> api.ts getRooms()
  -> server/src/api.ts
  -> server/src/db.ts
  -> MongoDB rooms collection
  -> server/src/room.ts getActiveUsers()
  -> Lobby.tsx renders rooms
```

### Room Creation Flow

```text
Lobby.tsx
  -> App.tsx onCreate
  -> api.ts createStoredRoom()
  -> server/src/api.ts POST /api/rooms
  -> server/src/db.ts insert room
  -> App.tsx opens NameDialog
```

### Room Join Flow

```text
NameDialog.tsx
  -> App.tsx confirmJoin()
  -> MultiplayerRoom.tsx
  -> connection.ts createRoom()
  -> browser WebSocket
  -> server/src/server.ts upgrade
  -> server/src/websocket.ts raw frame handling
  -> server/src/room.ts RoomHub join
  -> server/src/db.ts find room
```

### Cursor Sync Flow

```text
MultiplayerRoom.tsx pointermove
  -> connection.ts sendCursor()
  -> server/src/protocol.ts validation
  -> server/src/room.ts handleAction()
  -> connection.ts remote action listener
  -> interpolation.ts CursorTrack
  -> render.ts canvas loop
```

### Drawing Sync Flow

```text
MultiplayerRoom.tsx pointerdown/move/up
  -> local stroke rendered immediately
  -> connection.ts sendDraw()
  -> server/src/room.ts broadcast draw
  -> remote MultiplayerRoom.tsx appends stroke
  -> render.ts draws stroke
```

### Emoji Sync Flow

```text
MultiplayerRoom.tsx click
  -> local reaction rendered immediately
  -> connection.ts sendReaction()
  -> server/src/room.ts broadcast reaction
  -> remote MultiplayerRoom.tsx stores reaction
  -> render.ts animates reaction
```

## 5. What To Emphasize When Explaining

The strongest technical points are:

- raw WebSocket implementation
- runtime protocol validation
- clean client/server separation
- normalized coordinate system
- cursor throttling
- interpolation buffer
- sequence-number stale update rejection
- heartbeat cleanup
- MongoDB-backed room creation
- username-based presence
- modular file structure

The project is not just a UI demo. It shows the important engineering details behind real-time synchronization.
