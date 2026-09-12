# Interview And Explanation Q&A

Use this as a quick preparation sheet before presenting the project.

## 1. What Did You Build?

I built a real-time multiplayer room app. Users can create rooms from a dashboard, choose emoji or drawing mode, enter a username, and collaborate on a shared canvas. The app syncs cursors, presence, reactions, and drawing strokes between browser tabs using raw WebSockets.

## 2. Why Did You Remove Login And Register?

The latest product requirement was to remove login/register pages and ask for a username only when entering a room. So `/login` and `/register` now redirect to `/dashboard`, and room entry uses a lightweight username dialog.

## 3. Why Is MongoDB Used?

MongoDB stores room metadata so rooms survive refreshes and server restarts. `MONGODB_URI` is required because this final version does not save room records locally.

Live cursor movement, reactions, presence, and drawing strokes are not stored in MongoDB because they are fast-changing real-time state. Keeping them in memory avoids writing to the database for every pointer movement.

## 4. What Is The Difference Between Stored Room State And Live Room State?

Stored room state is durable:

- room id
- room name
- room mode
- creation timestamp

Live room state is temporary:

- connected sockets
- active users
- latest cursor positions
- current drawing messages
- short-lived reaction animations

Stored state lives in MongoDB. Live state lives in the Node server's `RoomHub`.

## 5. Why Raw WebSockets Instead Of Socket.IO?

The assignment is about understanding real-time sync. Raw WebSockets expose the important details: HTTP upgrade, frame parsing, ping/pong, close handling, message validation, throttling, sequencing, interpolation, and broadcast behavior.

Socket.IO would make production features easier, but it would hide many of the sync and transport details the assignment is testing.

## 6. How Does A User Join A Room?

The user starts on `/dashboard`, chooses or creates a room, then enters a username. Only after the username is submitted does the app open the WebSocket connection.

The first WebSocket message is `join`, which includes:

- room id
- client id
- display name
- color
- room mode

The server checks MongoDB to confirm the room exists before allowing the user in.

## 7. How Do You Prevent Fake Default Rooms?

The server only accepts WebSocket joins for rooms that exist in MongoDB. The dashboard creates rooms through `POST /api/rooms`. If someone directly opens a random `/room/:roomId`, the server returns `room-not-found`.

## 8. How Do Active User Names Work?

Active users come from WebSocket presence, not from the database. When a user joins, the server stores their `clientId`, name, and color in the active room. The dashboard API combines saved MongoDB room records with `RoomHub.getActiveUsers(roomId)`.

This is why the dashboard can show the actual names currently inside a room.

## 9. Why Were There Previously Too Many Active Viewers?

That happened because earlier versions used generated anonymous users or stale sessions. The final design fixes this by:

- asking for a username before join
- sending `leave` when the page hides
- closing dead sessions through heartbeat
- sweeping inactive sessions
- replacing older sockets with the same client id

## 10. How Does Cursor Sync Work?

The browser tracks pointer movement over the canvas, converts pixel coordinates to normalized coordinates from `0` to `1`, throttles updates to about 30Hz, and sends cursor messages to the server.

The server validates the message, checks the sequence number, stores the latest cursor for that participant, and broadcasts the update to other users in the room.

Remote clients add the cursor sample to an interpolation buffer and render it smoothly on the canvas.

## 11. Why Use Normalized Coordinates?

Different users may have different screen sizes. If one user sends pixel coordinate `500, 200`, that may not mean the same position on another user's screen.

Normalized coordinates solve this:

```text
x = 0 means left edge
x = 1 means right edge
y = 0 means top edge
y = 1 means bottom edge
```

Every client maps those values to its own canvas size.

## 12. How Do You Make Remote Cursors Smooth?

Remote cursors are rendered with a 100ms delay. Each remote cursor has a small buffer of recent samples. The renderer finds two samples around the target render time and interpolates between them.

This hides packet timing jitter. If packets arrive slightly late, the cursor still moves smoothly instead of jumping from point to point.

## 13. What Is Extrapolation?

If the renderer is slightly ahead of the latest received sample, it estimates the next cursor position using the velocity from the last two samples.

This is bounded to 180ms. After that, the cursor stops extrapolating so it does not drift unrealistically if the network drops.

## 14. How Do Sequence Numbers Help?

Each cursor, reaction, and draw message includes an increasing `seq` number.

The server remembers the latest accepted sequence for each session. If an incoming message has a sequence number lower than or equal to the latest one, it is stale and gets rejected.

This protects the room from old delayed actions being applied after newer actions.

## 15. How Does Drawing Mode Work?

Drawing mode starts a stroke on pointer down, adds points while dragging, and finishes the stroke on pointer up.

The sender sees the stroke immediately. The client batches stroke points and sends them to the server as `draw` messages. The server broadcasts those batches to the other users, and their clients append the points to the matching stroke id.

## 16. How Does Emoji Mode Work?

Emoji mode treats clicks/taps as short-lived reaction events. The sender renders the reaction immediately and sends a `reaction` message. Other clients receive the message and render the same reaction at the same normalized canvas position.

## 17. What Happens When A Tab Closes?

The browser sends a `leave` message during page cleanup. The server removes the session and broadcasts a `presence: leave` event.

If the browser closes unexpectedly and the leave message does not arrive, the server heartbeat and stale-session sweep remove the user after a short timeout.

## 18. What Happens If The Network Drops?

The client marks the connection as reconnecting and retries with exponential backoff up to 4 seconds. When the socket opens again, it sends the same join details with the same in-page client id.

The server replaces any older socket for that same client id, so the user does not appear twice.

## 19. What Validation Exists?

The server validates:

- message JSON
- message kind
- room id
- client id
- username
- hex color
- room mode
- coordinates
- sequence numbers
- reaction payloads
- draw packet size and points

Invalid messages receive an error response instead of being applied to room state.

## 20. What Tests Exist?

The server has protocol parser tests. They verify valid messages are accepted and malformed messages are rejected. This focuses testing on the most security-sensitive boundary: parsing untrusted WebSocket input.

## 21. How Would You Scale This?

For multiple server processes, I would add either sticky sessions by room id or a pub/sub system like Redis or NATS.

The scaling design would need:

- shared event fan-out across processes
- shared presence leases with TTL
- room-to-process routing
- durable room metadata still in MongoDB

The existing protocol can support that because room id, client id, mode, and action type are already explicit.

## 22. What Are The Main Tradeoffs?

The main tradeoffs are:

- raw WebSocket code is more educational and transparent but has fewer production features than Socket.IO
- in-memory live state is fast but not horizontally scalable by itself
- 100ms interpolation adds tiny visual delay but greatly improves smoothness
- reactions and drawings are live only, not historical replay data

## 23. What Should You Say If Asked About Security?

This is an assignment demo, so it focuses on sync. It has runtime validation and does not expose the MongoDB password in source docs, but it does not implement authentication, authorization, private room invites, or rate limiting.

Those would be the next production hardening steps.

## 24. Best 60-Second Answer

I built a React and Node real-time room app with MongoDB-backed room creation and raw WebSocket sync. The user starts on a dashboard, creates an emoji or drawing room, enters a display name, and joins a shared canvas. The server validates WebSocket messages, checks that rooms exist in MongoDB, manages presence, rejects stale sequence numbers, and broadcasts cursor, reaction, and drawing updates to other participants. The client throttles cursor traffic, batches drawing points, renders local actions instantly, and smooths remote cursor movement with interpolation and short bounded extrapolation. The architecture is modular, so routing, REST API, WebSocket connection handling, rendering, interpolation, protocol validation, MongoDB access, and room state are all separated.

## 25. Best Demo Order

1. Show the dashboard URL: `/dashboard`.
2. Create an emoji room.
3. Enter a username.
4. Open the same room in multiple tabs.
5. Show active names and remote cursors.
6. Click reactions.
7. Close one tab and show presence update.
8. Create a drawing room.
9. Draw from one tab and show stroke sync in another tab.
10. Explain that MongoDB stores rooms while WebSocket memory handles live sync.
