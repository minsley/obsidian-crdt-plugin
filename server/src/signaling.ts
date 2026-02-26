/**
 * Minimal WebRTC signaling server for y-webrtc.
 *
 * Peers subscribe to topics (room names) and publish messages to them.
 * The server only relays messages — it never sees document content.
 *
 * Protocol (JSON over WebSocket):
 *   { type: 'subscribe',   topics: string[] }
 *   { type: 'unsubscribe', topics: string[] }
 *   { type: 'publish',     topic: string, clients: number, ... }
 *   { type: 'ping' }  →  { type: 'pong' }
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const port = parseInt(process.env.SIGNAL_PORT || "4444", 10);

// topic -> set of subscriber WebSocket connections
const topics = new Map<string, Set<WebSocket>>();

function subscribe(conn: WebSocket, topic: string) {
  let subs = topics.get(topic);
  if (!subs) {
    subs = new Set();
    topics.set(topic, subs);
  }
  subs.add(conn);
}

function unsubscribe(conn: WebSocket, topic: string) {
  const subs = topics.get(topic);
  if (!subs) return;
  subs.delete(conn);
  if (subs.size === 0) topics.delete(topic);
}

function cleanup(conn: WebSocket, joined: Set<string>) {
  joined.forEach((topic) => unsubscribe(conn, topic));
  joined.clear();
}

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("crdt-coeditor signaling server\n");
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (conn) => {
  const joined = new Set<string>();
  let alive = true;

  conn.on("close", () => cleanup(conn, joined));
  conn.on("error", () => cleanup(conn, joined));
  conn.on("pong", () => { alive = true; });

  conn.on("message", (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "subscribe": {
        if (!Array.isArray(msg.topics)) break;
        const safeTops = msg.topics.filter((t: unknown): t is string => typeof t === "string");
        safeTops.forEach((topic) => {
          subscribe(conn, topic);
          joined.add(topic);
        });
        break;
      }

      case "unsubscribe": {
        if (!Array.isArray(msg.topics)) break;
        const safeTops = msg.topics.filter((t: unknown): t is string => typeof t === "string");
        safeTops.forEach((topic) => {
          unsubscribe(conn, topic);
          joined.delete(topic);
        });
        break;
      }

      case "publish": {
        if (typeof msg.topic !== "string") break;
        const subs = topics.get(msg.topic);
        if (subs) {
          const out = JSON.stringify(msg);
          subs.forEach((sub) => {
            if (sub !== conn && sub.readyState === WebSocket.OPEN) {
              sub.send(out);
            }
          });
        }
        break;
      }

      case "ping":
        conn.send(JSON.stringify({ type: "pong" }));
        break;
    }
  });

  // Heartbeat: drop dead connections every 30s
  const heartbeat = setInterval(() => {
    if (!alive) {
      cleanup(conn, joined);
      conn.terminate();
      clearInterval(heartbeat);
      return;
    }
    alive = false;
    conn.ping();
  }, 30_000);

  conn.on("close", () => clearInterval(heartbeat));
});

httpServer.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

httpServer.listen(port, () => {
  console.log(`[crdt-coeditor] signaling server on ws://localhost:${port}`);
});
