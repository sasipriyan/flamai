# Vercel Deployment Guide

## Current Hosting Plan

This project is prepared for Vercel hosting with MongoDB as the only room-data store.

Deployment shape:

```text
Frontend: Vercel static Vite build
Backend: Vercel Function exported from api/[...path].ts
Realtime: Vercel WebSockets beta
Room data: MongoDB Atlas only
Live presence/cursors: server WebSocket memory
```

Room records are not saved locally. If `MONGODB_URI` is missing, the backend returns a clear configuration error for room APIs and room joins.

## Why MongoDB Is Required

MongoDB stores the durable room records:

- room id
- room name
- room mode
- creator label
- created timestamp
- updated timestamp

The server still keeps live WebSocket state in memory because cursor movement, active sockets, reaction animations, and drawing packets are real-time events. They are not room records and should not be written to MongoDB on every frame.

## Files Added For Vercel

### `vercel.json`

The root Vercel config builds the Vite frontend and routes API/WebSocket traffic to the backend function:

```json
{
  "framework": "vite",
  "installCommand": "npm install",
  "buildCommand": "npm run build -w client",
  "outputDirectory": "client/dist",
  "functions": {
    "api/[...path].ts": {
      "maxDuration": 300
    }
  },
  "rewrites": [
    {
      "source": "/",
      "destination": "/index.html"
    },
    {
      "source": "/dashboard",
      "destination": "/index.html"
    },
    {
      "source": "/login",
      "destination": "/index.html"
    },
    {
      "source": "/register",
      "destination": "/index.html"
    },
    {
      "source": "/room/:roomId",
      "destination": "/index.html"
    }
  ]
}
```

The rewrites are important:

- `/api/*` is handled by the Vercel function automatically.
- `/api/rooms` is used for dashboard REST requests.
- `/api/room` is used for WebSocket upgrades.
- `/dashboard`, `/login`, `/register`, and `/room/:roomId` are rewritten to `index.html` so client routing works on refresh.

### `api/[...path].ts`

This is the Vercel Function entry:

```ts
import { createAppServer } from "../server/src/app.js";

export default createAppServer();
```

It exports the same Node HTTP/WebSocket server used locally.

### `server/src/app.ts`

This file contains the shared server factory.

Local development uses:

```text
server/src/server.ts
```

Vercel uses:

```text
api/[...path].ts
```

Both call the same `createAppServer()` function, so API behavior and WebSocket behavior stay consistent.

## Required Vercel Environment Variables

Add these in the Vercel dashboard:

```text
MONGODB_URI=mongodb+srv://SASI:<db_password>@hackathon.iyreas2.mongodb.net/?appName=Hackathon
MONGODB_DB=flamai
```

Do not commit the real password. Keep it only in local `server/.env` and Vercel environment variables.

The backend also accepts `MONGO_URI` as a fallback name, but `MONGODB_URI` is recommended.

## Client URLs In Production

In production, the client uses same-origin paths by default:

```text
REST API: /api/rooms
WebSocket: wss://your-project.vercel.app/api/room
```

That means `VITE_API_URL` and `VITE_WS_URL` are not required for the normal Vercel deployment.

If you host the backend somewhere else, then set:

```text
VITE_API_URL=https://your-backend-domain
VITE_WS_URL=wss://your-backend-domain/room
```

## Deploy Steps

1. Push the repo to GitHub.
2. Import the repo into Vercel.
3. Keep the project root as the root directory.
4. Let Vercel use `vercel.json`.
5. Add `MONGODB_URI` and `MONGODB_DB` in Vercel environment variables.
6. Deploy.

Open:

```text
https://your-project.vercel.app/dashboard
```

## Local Development

Create `.env`:

```bash
copy server\.env.example server\.env
```

Add the real MongoDB password in `server/.env`.

Run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173/dashboard
```

## Production Caveat

Vercel WebSockets are in beta. A WebSocket connection is pinned to one Function instance for the lifetime of that connection, but new connections or reconnects can reach another instance. MongoDB already handles durable room records. If the app needs large-scale production-grade presence across many function instances, add shared pub/sub or presence coordination such as Redis.
