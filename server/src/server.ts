import { createAppServer } from "./app.js";

const PORT = Number(process.env.PORT ?? 8090);
const server = createAppServer();

server.listen(PORT, () => {
  console.log(`Raw WebSocket server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint ws://localhost:${PORT}/room`);
  console.log("Room storage: mongodb");
});
