import { spawn } from "node:child_process";
import { createServer } from "node:net";

const isWindows = process.platform === "win32";
const requestedPort = Number(process.env.PORT ?? 8090);
const serverPort = await findAvailablePort(requestedPort);
const wsUrl = process.env.VITE_WS_URL ?? `ws://localhost:${serverPort}/room`;

if (serverPort !== requestedPort) {
  console.log(`Port ${requestedPort} is busy, using ${serverPort} for the WebSocket server.`);
}

function npmCommand(args) {
  return isWindows
    ? {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", "npm", ...args],
      }
    : {
        command: "npm",
        args,
      };
}

const processes = [
  {
    name: "server",
    ...npmCommand(["run", "dev", "-w", "server"]),
    env: {
      PORT: String(serverPort),
    },
  },
  {
    name: "client",
    ...npmCommand(["run", "dev", "-w", "client"]),
    env: {
      VITE_API_URL: process.env.VITE_API_URL ?? `http://localhost:${serverPort}`,
      VITE_WS_URL: wsUrl,
    },
  },
];

const children = processes.map(({ name, command, args }) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...processes.find((processInfo) => processInfo.name === name)?.env,
    },
  });

  child.stdout.on("data", (chunk) => writePrefixed(name, chunk));
  child.stderr.on("data", (chunk) => writePrefixed(name, chunk));
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${name}] exited with ${signal ?? code}`);
    shutdown(code ?? 1);
  });

  return child;
});

let shuttingDown = false;

function writePrefixed(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim().length > 0) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error(`No available port found from ${startPort} to ${startPort + 49}.`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}
