import http from "node:http";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";

const config = loadConfig();

// Set YPERSISTENCE env var BEFORE importing y-websocket/bin/utils.
// This tells y-websocket to use its own built-in LevelDB persistence,
// which avoids the duplicate yjs issue that breaks custom setPersistence.
process.env.YPERSISTENCE = config.leveldbPath;

// @ts-expect-error - y-websocket/bin/utils has no type declarations
const { setupWSConnection } = await import("y-websocket/bin/utils");

// --- Room Registry ---
// Tracks active rooms so the sidecar can query them via HTTP.
const activeRooms = new Map<string, number>(); // room name -> client count

function addClient(room: string) {
  activeRooms.set(room, (activeRooms.get(room) || 0) + 1);
}

function removeClient(room: string) {
  const count = (activeRooms.get(room) || 1) - 1;
  if (count <= 0) {
    setTimeout(() => {
      if ((activeRooms.get(room) || 0) <= 0) {
        activeRooms.delete(room);
      }
    }, 5000);
    activeRooms.set(room, 0);
  } else {
    activeRooms.set(room, count);
  }
}

// --- HTTP + WebSocket Server ---
const httpServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/rooms") {
    const rooms = Array.from(activeRooms.entries())
      .filter(([_, count]) => count > 0)
      .map(([name, count]) => ({ name, clients: count }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rooms }));
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const roomName = decodeURIComponent((req.url || "/").slice(1));
  addClient(roomName);

  setupWSConnection(ws, req, { docName: roomName });

  ws.on("close", () => {
    removeClient(roomName);
  });
});

httpServer.listen(config.port, config.host, () => {
  console.log(
    `[crdt-coeditor] y-websocket server running on ${config.host}:${config.port}`
  );
  console.log(`[crdt-coeditor] LevelDB path: ${config.leveldbPath}`);
  console.log(
    `[crdt-coeditor] Room list: http://${config.host}:${config.port}/rooms`
  );
});
