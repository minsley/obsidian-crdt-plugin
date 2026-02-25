import { Plugin, TFile, MarkdownView, Notice, Modal, Setting } from "obsidian";
import { WebRTCSession } from "./webrtc-session";
import { createCollabExtension } from "./cm-extension";
import { log, warn, debug, setDebug } from "./log";
import {
  CRDTCoEditorSettings,
  CRDTCoEditorSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

const ADJECTIVES = [
  "amber", "bold", "calm", "dark", "easy", "fast", "gold", "hazy",
  "iron", "just", "keen", "lime", "mild", "neat", "open", "pink",
  "quick", "rare", "sage", "teal", "unit", "vast", "warm", "zinc",
];

const NOUNS = [
  "arch", "beam", "cave", "dock", "edge", "fern", "gate", "hive",
  "isle", "jade", "knot", "lake", "mesa", "node", "onyx", "peak",
  "quay", "reef", "star", "tide", "vale", "wave", "yard", "zone",
];

function generateRoomCode(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 100).toString().padStart(2, "0");
  return `${adj}-${noun}-${num}`;
}

export default class CRDTCoEditorPlugin extends Plugin {
  settings: CRDTCoEditorSettings = DEFAULT_SETTINGS;
  sessions = new Map<string, WebRTCSession>();
  private statusBarEl: HTMLElement | null = null;
  private collabActive = false;
  private activeRoomCode: string | null = null;

  async onload() {
    await this.loadSettings();
    setDebug(this.settings.debugLogging);
    log("Plugin loaded (WebRTC mode)");
    this.addSettingTab(new CRDTCoEditorSettingTab(this.app, this));

    this.registerEditorExtension(createCollabExtension(this));

    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();

    this.addCommand({
      id: "start-collab",
      name: "Start collaboration (host)",
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

    this.addRibbonIcon("users", "Toggle collaboration", () => {
      if (this.collabActive) {
        this.stopCollab();
      } else {
        this.startCollab();
      }
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (this.collabActive && file instanceof TFile && file.extension === "md") {
          this.openSession(file, this.activeRoomCode ?? undefined);
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
              warn(`External modification detected for ${file.path} — Yjs state is authoritative.`);
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

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice("Open a markdown file first");
      return;
    }

    const roomCode = generateRoomCode();
    this.activeRoomCode = roomCode;
    this.collabActive = true;
    this.updateStatusBar();

    this.openSession(activeFile, roomCode);

    new Notice(`Collaboration started! Room code: ${roomCode} (copied)`);
    navigator.clipboard.writeText(roomCode);
    log(`Hosting room: ${roomCode}`);
  }

  stopCollab(): void {
    for (const [, session] of this.sessions) {
      session.destroy();
    }
    this.sessions.clear();
    this.collabActive = false;
    this.activeRoomCode = null;
    this.updateStatusBar();
    log("Collaboration stopped");
  }

  private showJoinModal(): void {
    new JoinCollabModal(this.app, async (roomCode) => {
      const activeFile = this.app.workspace.getActiveFile();

      this.activeRoomCode = roomCode;
      this.collabActive = true;
      this.updateStatusBar();

      if (activeFile && activeFile.extension === "md") {
        this.openSession(activeFile, roomCode);
        new Notice(`Joined room: ${roomCode}`);
      } else {
        new Notice(`Joined room: ${roomCode} — open a file to start editing`);
      }

      log(`Joined room: ${roomCode}`);
    });
  }

  private copyRoomCode(): void {
    if (!this.activeRoomCode) {
      new Notice("Start or join a collaboration first");
      return;
    }
    navigator.clipboard.writeText(this.activeRoomCode);
    new Notice(`Room code copied: ${this.activeRoomCode}`);
  }

  // --- Session management ---

  openSession(file: TFile, roomCode?: string) {
    if (this.sessions.has(file.path)) return;

    const room = roomCode ?? this.activeRoomCode ?? generateRoomCode();
    const session = new WebRTCSession(this.app.vault, file, room, this.settings);
    this.sessions.set(file.path, session);
    debug(`Opened WebRTC session for ${file.path} in room ${room}`);
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
    if (this.collabActive && this.activeRoomCode) {
      this.statusBarEl.setText(`Collab: ${this.activeRoomCode}`);
    } else if (this.collabActive) {
      this.statusBarEl.setText("Collab: Active");
    } else {
      this.statusBarEl.setText("");
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    setDebug(this.settings.debugLogging);
    await this.saveData(this.settings);
  }
}

// --- Join Modal ---

class JoinCollabModal extends Modal {
  private roomCode = "";

  constructor(app: any, private onSubmit: (roomCode: string) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Join Collaboration" });

    new Setting(contentEl)
      .setName("Room code")
      .setDesc("Code shared by the host (e.g. calm-reef-42)")
      .addText((text) =>
        text
          .setPlaceholder("calm-reef-42")
          .onChange((v) => (this.roomCode = v.trim()))
      );

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Join")
        .setCta()
        .onClick(() => {
          if (!this.roomCode) {
            new Notice("Please enter a room code");
            return;
          }
          this.close();
          this.onSubmit(this.roomCode);
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
