import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { AgentDocumentSession } from "./document-session.js";
import type { SidecarConfig } from "./config.js";

export interface ManagedSession {
  id: string;
  roomName: string;
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  docSession: AgentDocumentSession;
}

/**
 * Manages y-websocket connections for the agent sidecar.
 * Each session connects to one room (= one document).
 */
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private nextId = 1;

  constructor(private config: SidecarConfig) {}

  /**
   * Connect to a document room. Returns a session ID for subsequent tool calls.
   * Waits for initial sync before returning.
   */
  async connect(vault: string, filePath: string): Promise<ManagedSession> {
    const roomName = `obsidian/${vault}/${filePath}`;

    // Check if already connected to this room
    for (const session of this.sessions.values()) {
      if (session.roomName === roomName) {
        return session;
      }
    }

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("content");

    const provider = new WebsocketProvider(
      this.config.serverUrl,
      roomName,
      ydoc
    );

    // Set awareness to identify as an agent
    provider.awareness.setLocalStateField("user", {
      name: "Claude Agent",
      color: "#8B5CF6",
    });

    // Wait for initial sync
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out connecting to room: ${roomName}`));
      }, 10_000);

      provider.on("sync", (isSynced: boolean) => {
        if (isSynced) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const id = `session_${this.nextId++}`;
    const docSession = new AgentDocumentSession(ytext, provider.awareness);
    const managed: ManagedSession = {
      id,
      roomName,
      ydoc,
      provider,
      docSession,
    };

    this.sessions.set(id, managed);
    return managed;
  }

  get(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  disconnect(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.provider.awareness.setLocalState(null);
    session.provider.disconnect();
    session.provider.destroy();
    session.ydoc.destroy();
    this.sessions.delete(id);
    return true;
  }

  disconnectAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.disconnect(id);
    }
  }
}
