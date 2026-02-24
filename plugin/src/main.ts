import { Plugin, TFile, MarkdownView, Notice, Modal, Setting, Platform } from "obsidian";
import { CRDTSession } from "./session";
import { createCollabExtension } from "./cm-extension";
import { ServerManager } from "./server-manager";
import { log, warn, debug, setDebug } from "./log";
import {
  CRDTCoEditorSettings,
  CRDTCoEditorSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

export default class CRDTCoEditorPlugin extends Plugin {
  settings: CRDTCoEditorSettings = DEFAULT_SETTINGS;
  sessions = new Map<string, CRDTSession>();
  serverManager = new ServerManager();
  private statusBarEl: HTMLElement | null = null;
  private collabActive = false;

  async onload() {
    await this.loadSettings();
    setDebug(this.settings.debugLogging);
    log("Plugin loaded");
    this.addSettingTab(new CRDTCoEditorSettingTab(this.app, this));

    // Register the CM6 collab extension (shared across all editors)
    this.registerEditorExtension(createCollabExtension(this));

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();

    // --- Commands ---

    this.addCommand({
      id: "start-collab",
      name: "Start collaboration (host server)",
      callback: () => this.startCollab(),
    });

    this.addCommand({
      id: "stop-collab",
      name: "Stop collaboration",
      callback: () => this.stopCollab(),
    });

    this.addCommand({
      id: "join-collab",
      name: "Join collaboration session",
      callback: () => this.showJoinModal(),
    });

    this.addCommand({
      id: "copy-room-code",
      name: "Copy room code for current file",
      callback: () => this.copyRoomCode(),
    });

    // --- Ribbon icon ---

    this.addRibbonIcon("users", "Toggle collaboration", () => {
      if (this.collabActive) {
        this.stopCollab();
      } else {
        this.startCollab();
      }
    });

    // --- Events ---

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (this.collabActive && file instanceof TFile && file.extension === "md") {
          this.openSession(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile) {
          const session = this.sessions.get(file.path);
          if (session && !session.isSelfWrite) {
            const diskContent = await this.app.vault.read(file);
            const ytextContent = session.ytext.toString();
            if (diskContent !== ytextContent) {
              warn(
                `External modification detected for ${file.path} — Yjs state is authoritative.`
              );
            }
          }
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (this.collabActive) {
          this.cleanupStaleSessions();
        }
      })
    );
  }

  async onunload() {
    this.stopCollab();
  }

  // --- Collaboration lifecycle ---

  async startCollab(): Promise<void> {
    if (this.collabActive) {
      new Notice("Collaboration is already active");
      return;
    }

    if (!Platform.isDesktopApp) {
      new Notice("Collaboration requires Obsidian desktop");
      return;
    }

    try {
      // Resolve server script path relative to plugin directory
      const pluginDir = this.getPluginDir();
      const serverScript = `${pluginDir}/server.js`;

      // Check if bundled server.js exists — if not, fall back to server/dist/server.js
      // in the workspace (for development)
      const dataDir = `${pluginDir}/server-data`;

      new Notice("Starting collaboration server...");

      await this.serverManager.start(
        serverScript,
        this.settings.collabPort,
        this.settings.collabHost,
        dataDir
      );

      // Update settings to point at the managed server
      this.settings.serverUrl = this.serverManager.wsUrl;
      this.collabActive = true;
      this.updateStatusBar();

      // Open session for current file
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === "md") {
        this.openSession(activeFile);
        // Register room code
        const roomName = `obsidian/${this.app.vault.getName()}/${activeFile.path}`;
        const code = await this.serverManager.createRoomCode(roomName);
        new Notice(`Collaboration active! Room code: ${code}`);
        navigator.clipboard.writeText(code);
        log(`Room code for ${activeFile.path}: ${code} (copied to clipboard)`);
      } else {
        new Notice("Collaboration server started");
      }
    } catch (e: any) {
      warn(`Failed to start server: ${e.message}`);
      new Notice(`Failed to start collaboration: ${e.message}`);
    }
  }

  stopCollab(): void {
    // Destroy all sessions
    for (const [, session] of this.sessions) {
      session.destroy();
    }
    this.sessions.clear();

    // Stop server
    this.serverManager.stop();
    this.collabActive = false;
    this.updateStatusBar();
    log("Collaboration stopped");
  }

  private async showJoinModal(): Promise<void> {
    const modal = new JoinCollabModal(this.app, async (serverUrl, roomCode) => {
      try {
        // Update server URL
        this.settings.serverUrl = serverUrl;
        this.collabActive = true;
        this.updateStatusBar();

        // Resolve room code to room name
        const httpUrl = serverUrl.replace(/^ws/, "http");
        const res = await fetch(
          `${httpUrl}/rooms/lookup/${encodeURIComponent(roomCode)}`
        );
        if (!res.ok) {
          throw new Error("Invalid room code");
        }
        const data = await res.json();
        const roomName: string = data.roomName;

        // Extract file path from room name: "obsidian/<vault>/<filePath>"
        const parts = roomName.split("/");
        const filePath = parts.slice(2).join("/");

        // Create the file locally if it doesn't exist
        let file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file) {
          // Create parent directories if needed
          const dir = filePath.substring(0, filePath.lastIndexOf("/"));
          if (dir) {
            await this.app.vault.createFolder(dir).catch(() => {});
          }
          file = await this.app.vault.create(filePath, "");
        }

        if (file instanceof TFile) {
          // Open the file
          await this.app.workspace.openLinkText(filePath, "", false);

          // Open a CRDT session with the resolved room name
          this.openSessionWithRoom(file, roomName);

          new Notice(`Joined collaboration: ${filePath}`);
        }
      } catch (e: any) {
        new Notice(`Failed to join: ${e.message}`);
        warn(`Join failed: ${e.message}`);
        this.collabActive = false;
        this.updateStatusBar();
      }
    });
    modal.open();
  }

  private async copyRoomCode(): Promise<void> {
    if (!this.serverManager.isRunning) {
      new Notice("Start collaboration first");
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    const roomName = `obsidian/${this.app.vault.getName()}/${activeFile.path}`;
    try {
      const code = await this.serverManager.createRoomCode(roomName);
      await navigator.clipboard.writeText(code);
      new Notice(`Room code copied: ${code}`);
    } catch (e: any) {
      new Notice(`Failed to get room code: ${e.message}`);
    }
  }

  // --- Session management ---

  openSession(file: TFile) {
    if (this.sessions.has(file.path)) return;

    const vaultName = this.app.vault.getName();
    const session = new CRDTSession(
      this.app.vault,
      file,
      vaultName,
      this.settings
    );
    this.sessions.set(file.path, session);
  }

  /**
   * Open a session with an explicit room name (for joining via room code).
   * The room name may not match the local vault/file path convention.
   */
  private openSessionWithRoom(file: TFile, roomName: string) {
    if (this.sessions.has(file.path)) return;

    const session = new CRDTSession(
      this.app.vault,
      file,
      "", // vault name is embedded in roomName already
      this.settings,
      roomName // explicit room override
    );
    this.sessions.set(file.path, session);
  }

  private cleanupStaleSessions() {
    const openPaths = new Set<string>();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file) {
        openPaths.add(leaf.view.file.path);
      }
    });

    for (const [path, session] of this.sessions) {
      if (!openPaths.has(path)) {
        session.destroy();
        this.sessions.delete(path);
      }
    }
  }

  private updateStatusBar() {
    if (!this.statusBarEl) return;
    if (this.collabActive) {
      const port = this.serverManager.isRunning
        ? ` (hosting :${this.serverManager.port})`
        : " (joined)";
      this.statusBarEl.setText(`Collab: Active${port}`);
    } else {
      this.statusBarEl.setText("");
    }
  }

  private getPluginDir(): string {
    // @ts-expect-error — accessing internal basePath
    const vaultPath = this.app.vault.adapter.basePath;
    return `${vaultPath}/.obsidian/plugins/obsidian-crdt-coeditor`;
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings() {
    setDebug(this.settings.debugLogging);
    await this.saveData(this.settings);
  }
}

// --- Join Modal ---

class JoinCollabModal extends Modal {
  private serverUrl = "ws://localhost:1234";
  private roomCode = "";

  constructor(
    app: any,
    private onSubmit: (serverUrl: string, roomCode: string) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Join Collaboration" });

    new Setting(contentEl)
      .setName("Server URL")
      .setDesc("WebSocket URL of the host's server")
      .addText((text) =>
        text
          .setPlaceholder("ws://192.168.1.5:1234")
          .setValue(this.serverUrl)
          .onChange((v) => (this.serverUrl = v))
      );

    new Setting(contentEl)
      .setName("Room code")
      .setDesc("Code shared by the host (e.g. calm-reef-42)")
      .addText((text) =>
        text
          .setPlaceholder("calm-reef-42")
          .onChange((v) => (this.roomCode = v))
      );

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Join")
        .setCta()
        .onClick(() => {
          if (!this.roomCode.trim()) {
            new Notice("Please enter a room code");
            return;
          }
          this.close();
          this.onSubmit(this.serverUrl, this.roomCode.trim());
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
