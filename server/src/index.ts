import http from "node:http";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { RoomCodeRegistry } from "./room-codes.js";

const config = loadConfig();

// Set YPERSISTENCE env var BEFORE importing y-websocket/bin/utils.
process.env.YPERSISTENCE = config.leveldbPath;

// @ts-expect-error - y-websocket/bin/utils has no type declarations
const { setupWSConnection } = await import("y-websocket/bin/utils");

// --- Room Registry ---
const activeRooms = new Map<string, number>(); // room name -> client count
const roomCodes = new RoomCodeRegistry();

function addClient(room: string) {
  activeRooms.set(room, (activeRooms.get(room) || 0) + 1);
}

function removeClient(room: string) {
  const count = (activeRooms.get(room) || 1) - 1;
  if (count <= 0) {
    setTimeout(() => {
      if ((activeRooms.get(room) || 0) <= 0) {
        activeRooms.delete(room);
        roomCodes.remove(room);
      }
    }, 5000);
    activeRooms.set(room, 0);
  } else {
    activeRooms.set(room, count);
  }
}

/** Read the full request body as a string. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// --- HTTP + WebSocket Server ---
const httpServer = http.createServer(async (req, res) => {
  // CORS headers for cross-origin requests from Obsidian
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/rooms") {
    const rooms = Array.from(activeRooms.entries())
      .filter(([_, count]) => count > 0)
      .map(([name, count]) => ({
        name,
        clients: count,
        code: roomCodes.entries().find((e) => e.roomName === name)?.code,
      }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rooms }));
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // POST /rooms/create — register a room code
  if (req.method === "POST" && req.url === "/rooms/create") {
    try {
      const body = JSON.parse(await readBody(req));
      const roomName = body.roomName;
      if (!roomName || typeof roomName !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "roomName is required" }));
        return;
      }
      const code = roomCodes.create(roomName);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code, roomName }));
    } catch (e: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /rooms/lookup/:code — resolve a room code
  if (req.method === "GET" && req.url?.startsWith("/rooms/lookup/")) {
    const code = decodeURIComponent(req.url.slice("/rooms/lookup/".length));
    const roomName = roomCodes.lookup(code);
    if (roomName) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code, roomName }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unknown room code" }));
    }
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
