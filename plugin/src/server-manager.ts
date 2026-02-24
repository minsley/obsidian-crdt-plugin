import { Platform, Notice } from "obsidian";
import { log, warn, debug } from "./log";
import type { ChildProcess } from "child_process";

/**
 * Manages a y-websocket server as a child process.
 * Only works on Obsidian desktop (Electron with Node integration).
 */
export class ServerManager {
  private proc: ChildProcess | null = null;
  private _port = 0;
  private _host = "";

  get isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  get port(): number {
    return this._port;
  }

  get wsUrl(): string {
    return `ws://${this._host}:${this._port}`;
  }

  get httpUrl(): string {
    return `http://${this._host}:${this._port}`;
  }

  /**
   * Start the y-websocket server as a child process.
   * @param serverScript Absolute path to server/dist/server.js
   * @param port Port to listen on
   * @param host Host to bind to ("0.0.0.0" for LAN, "127.0.0.1" for local only)
   * @param dataDir Directory for LevelDB persistence
   */
  async start(
    serverScript: string,
    port: number,
    host: string,
    dataDir: string
  ): Promise<void> {
    if (!Platform.isDesktopApp) {
      throw new Error("Server management requires Obsidian desktop");
    }

    if (this.isRunning) {
      debug("Server already running");
      return;
    }

    // Use Electron's bundled Node.js to avoid PATH issues
    const nodePath = process.execPath;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require("child_process") as typeof import("child_process");

    log(`Starting server: ${nodePath} ${serverScript} (port=${port}, host=${host})`);

    this.proc = spawn(nodePath, [serverScript], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: host,
        LEVELDB_PATH: dataDir,
        // Electron sets this; clear it so the child runs as plain Node
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this._port = port;
    this._host = host === "0.0.0.0" ? "127.0.0.1" : host;

    // Forward server output to debug log
    this.proc.stdout?.on("data", (data: Buffer) => {
      debug(`[server stdout] ${data.toString().trim()}`);
    });
    this.proc.stderr?.on("data", (data: Buffer) => {
      debug(`[server stderr] ${data.toString().trim()}`);
    });

    this.proc.on("exit", (code, signal) => {
      log(`Server exited (code=${code}, signal=${signal})`);
      this.proc = null;
      if (code !== 0 && code !== null) {
        new Notice(`CRDT server crashed (exit code ${code})`);
      }
    });

    // Wait for server to be ready by polling /health
    await this.waitForHealth(5000);
    log(`Server ready at ${this.httpUrl}`);
  }

  stop(): void {
    if (this.proc) {
      log("Stopping server...");
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }

  /**
   * Register a room code for a room name.
   */
  async createRoomCode(roomName: string): Promise<string> {
    const res = await fetch(`${this.httpUrl}/rooms/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName }),
    });
    if (!res.ok) throw new Error(`Failed to create room code: ${res.status}`);
    const data = await res.json();
    return data.code;
  }

  /**
   * Resolve a room code to a room name.
   */
  async lookupRoomCode(code: string): Promise<string | null> {
    const res = await fetch(`${this.httpUrl}/rooms/lookup/${encodeURIComponent(code)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to lookup room code: ${res.status}`);
    const data = await res.json();
    return data.roomName;
  }

  private async waitForHealth(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${this.httpUrl}/health`);
        if (res.ok) return;
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
  }
}
