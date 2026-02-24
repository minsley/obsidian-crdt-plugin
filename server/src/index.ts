import http from "node:http";
import { WebSocketServer } from "ws";
// @ts-expect-error - y-websocket/bin/utils has no type declarations
import { setupWSConnection, setPersistence } from "y-websocket/bin/utils";
import { LeveldbPersistence } from "y-leveldb";
import { loadConfig } from "./config.js";

const config = loadConfig();

// --- Room Registry ---
// Tracks active rooms so the sidecar can query them via HTTP.
const activeRooms = new Map<string, number>(); // room name -> client count

function addClient(room: string) {
  activeRooms.set(room, (activeRooms.get(room) || 0) + 1);
}

function removeClient(room: string) {
  const count = (activeRooms.get(room) || 1) - 1;
  if (count <= 0) {
    // Grace period: keep room listed for 5s after last client disconnects
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

// --- LevelDB Persistence ---
const ldb = new LeveldbPersistence(config.leveldbPath);

setPersistence({
  provider: ldb,
  bindState: async (docName: string, ydoc: any) => {
    const persistedYdoc = await ldb.getYDoc(docName);
    const newUpdates = (ydoc as any).constructor.encodeStateAsUpdate(ydoc);
    ldb.storeUpdate(docName, newUpdates);

    const persistedState = (ydoc as any).constructor.encodeStateAsUpdate(
      persistedYdoc
    );
    (ydoc as any).constructor.applyUpdate(ydoc, persistedState);

    ydoc.on("update", (update: Uint8Array) => {
      ldb.storeUpdate(docName, update);
    });
  },
  writeState: async (_docName: string, _ydoc: any) => {
    // State is continuously written via the update handler above
  },
});

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
