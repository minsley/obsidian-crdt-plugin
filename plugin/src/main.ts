import {
  Plugin,
  TFile,
  MarkdownView,
  Notice,
  setIcon,
} from "obsidian";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";
import { WebRTCSession } from "./webrtc-session";
import { createCollabExtension } from "./cm-extension";
import { log, warn, debug, setDebug } from "./log";
import {
  CRDTCoEditorSettings,
  CRDTCoEditorSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import {
  getCollabId,
  setCollabId,
  removeCollabId,
  findFileByCollabId,
} from "./frontmatter";
import { deleteYjsState } from "./persistence";
import { generateName, colorForPeerIndex } from "./identity";
import type { CollabState, FileCollabInfo } from "./collab-state";
import { OnlineModal } from "./online-modal";

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

function stateIcon(state: CollabState): string {
  switch (state) {
    case "offline":      return "radio-tower";
    case "connecting":   return "loader";
    case "live":         return "wifi";
    case "disconnecting": return "loader";
  }
}

function stateTooltip(state: CollabState, peerCount = 0): string {
  switch (state) {
    case "offline":      return "Go Online";
    case "connecting":   return "Connecting...";
    case "live":         return `Live — ${peerCount} peer${peerCount !== 1 ? "s" : ""} (click to go offline)`;
    case "disconnecting": return "Disconnecting...";
  }
}

export default class CRDTCoEditorPlugin extends Plugin {
  settings: CRDTCoEditorSettings = DEFAULT_SETTINGS;

  // Per-file collaboration state. Key = file.path
  collabFiles = new Map<string, FileCollabInfo>();

  // One header button per MarkdownView
  private headerButtons = new WeakMap<MarkdownView, HTMLElement>();

  async onload() {
    await this.loadSettings();
    setDebug(this.settings.debugLogging);
    log("Plugin loaded (WebRTC mode)");
    this.addSettingTab(new CRDTCoEditorSettingTab(this.app, this));

    this.registerEditorExtension(createCollabExtension(this));

    this.addCommand({
      id: "make-collaborative",
      name: "Make Collaborative",
      editorCallback: (_, ctx) => {
        if (ctx.file) this.makeCollaborative(ctx.file);
      },
    });

    this.addCommand({
      id: "go-online",
      name: "Go Online",
      editorCallback: (_, ctx) => {
        if (ctx.file) this.goOnline(ctx.file);
      },
    });

    this.addCommand({
      id: "go-offline",
      name: "Go Offline",
      editorCallback: (_, ctx) => {
        if (ctx.file) this.goOffline(ctx.file);
      },
    });

    this.addCommand({
      id: "copy-room-code",
      name: "Copy Room Code",
      editorCallback: (_, ctx) => {
        if (ctx.file) this.copyRoomCode(ctx.file);
      },
    });

    this.addCommand({
      id: "unlink-collaboration",
      name: "Unlink Collaboration",
      editorCallback: (_, ctx) => {
        if (ctx.file) this.unlinkFile(ctx.file);
      },
    });

    // Header buttons
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.syncHeaderButtons())
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.syncHeaderButtons())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () =>
        this.syncHeaderButtons()
      )
    );

    // File explorer context menu
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        if (!(abstractFile instanceof TFile) || abstractFile.extension !== "md")
          return;
        const file = abstractFile;
        const uuid = getCollabId(this.app, file);
        if (!uuid) {
          menu.addItem((item) =>
            item
              .setTitle("Make Collaborative")
              .setIcon("users")
              .onClick(() => this.makeCollaborative(file))
          );
        } else {
          const info = this.collabFiles.get(file.path);
          const state = info?.state ?? "offline";
          if (state === "offline") {
            menu.addItem((item) =>
              item
                .setTitle("Go Online")
                .setIcon("radio-tower")
                .onClick(() => this.goOnline(file))
            );
          } else if (state === "live") {
            menu.addItem((item) =>
              item
                .setTitle("Go Offline")
                .setIcon("wifi-off")
                .onClick(() => this.goOffline(file))
            );
          }
          if (info?.roomCode) {
            menu.addItem((item) =>
              item
                .setTitle("Copy Room Code")
                .setIcon("copy")
                .onClick(() => this.copyRoomCode(file))
            );
          }
          menu.addItem((item) =>
            item
              .setTitle("Unlink Collaboration")
              .setIcon("unlink")
              .onClick(() => this.unlinkFile(file))
          );
        }
      })
    );

    // Handle external file modifications while live
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile) {
          const info = this.collabFiles.get(file.path);
          if (info?.session && !info.session.isSelfWrite) {
            const diskContent = await this.app.vault.read(file);
            const ytextContent = info.session.ytext.toString();
            if (diskContent !== ytextContent) {
              warn(
                `External modification detected for ${file.path} — Yjs state is authoritative`
              );
            }
          }
        }
      })
    );
  }

  async onunload() {
    for (const [, info] of this.collabFiles) {
      if (info.session) {
        await info.session.flushAndSave().catch(() => {});
        info.session.destroy();
      }
    }
    this.collabFiles.clear();
  }

  // --- Collaboration lifecycle ---

  async makeCollaborative(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      new Notice("Only markdown files can be made collaborative");
      return;
    }

    const existing = getCollabId(this.app, file);
    if (existing) {
      new Notice("File is already collaborative");
      return;
    }

    const uuid = crypto.randomUUID();
    await setCollabId(this.app, file, uuid);

    this.collabFiles.set(file.path, {
      uuid,
      state: "offline",
      peerCount: 0,
    });

    this.syncHeaderButtons();
    new Notice(`File is now collaborative`);
    log(`makeCollaborative: ${file.path} uuid=${uuid}`);
  }

  goOnline(file: TFile): void {
    const uuid = getCollabId(this.app, file);
    if (!uuid) {
      new Notice('Make this file collaborative first (right-click → "Make Collaborative")');
      return;
    }

    // Ensure state entry exists
    if (!this.collabFiles.has(file.path)) {
      this.collabFiles.set(file.path, {
        uuid,
        state: "offline",
        peerCount: 0,
      });
    }

    const info = this.collabFiles.get(file.path)!;
    if (info.state !== "offline") {
      new Notice(`Already ${info.state}`);
      return;
    }

    new OnlineModal(this.app, this, file).open();
  }

  async goOffline(file: TFile): Promise<void> {
    const info = this.collabFiles.get(file.path);
    if (!info?.session) return;

    this.setFileState(file.path, "disconnecting");

    try {
      await info.session.flushAndSave();
    } catch (e) {
      warn(`goOffline: flush failed for ${file.path}: ${e}`);
    }

    info.session.destroy();
    info.session = undefined;
    info.roomCode = undefined;

    this.setFileState(file.path, "offline");
    new Notice("Went offline");
    log(`goOffline: ${file.path}`);
  }

  async unlinkFile(file: TFile): Promise<void> {
    const uuid = getCollabId(this.app, file);
    if (!uuid) {
      new Notice("File is not collaborative");
      return;
    }

    const info = this.collabFiles.get(file.path);
    if (info?.session) {
      await this.goOffline(file);
    }

    await removeCollabId(this.app, file);
    await deleteYjsState(this.app, uuid);
    this.collabFiles.delete(file.path);

    this.syncHeaderButtons();
    new Notice("Collaboration unlinked");
    log(`unlinkFile: ${file.path} uuid=${uuid}`);
  }

  copyRoomCode(file: TFile): void {
    const info = this.collabFiles.get(file.path);
    if (!info?.roomCode) {
      new Notice("No active room code — go online first");
      return;
    }
    navigator.clipboard.writeText(info.roomCode);
    new Notice(`Room code copied: ${info.roomCode}`);
  }

  // Called by OnlineModal — host path
  beginHosting(file: TFile): string {
    this.ensureSettingsIdentity();

    const uuid = getCollabId(this.app, file)!;
    const roomCode = generateRoomCode();

    const session = new WebRTCSession(
      this.app,
      file,
      uuid,
      roomCode,
      this.settings
    );

    session.on("peers", (count) => {
      const i = this.collabFiles.get(file.path);
      if (i) {
        i.peerCount = count;
        this.updateHeaderButtonsForFile(file);
      }
    });

    const info = this.collabFiles.get(file.path)!;
    info.session = session;
    info.roomCode = roomCode;
    info.state = "live";
    info.peerCount = 0;

    this.syncHeaderButtons();
    log(`beginHosting: ${file.path} room=${roomCode}`);
    return roomCode;
  }

  // Called by OnlineModal — join path
  async joinSession(roomCode: string): Promise<void> {
    this.ensureSettingsIdentity();

    const uuid = await this.discoverUuid(roomCode);
    log(`joinSession: discovered uuid=${uuid} for room=${roomCode}`);

    // Find or create the file with this UUID
    let file = findFileByCollabId(this.app, uuid);
    if (!file) {
      // New file for this collab document
      const baseName = roomCode;
      let filePath = `${baseName}.md`;
      let n = 2;
      while (this.app.vault.getAbstractFileByPath(filePath)) {
        filePath = `${baseName}-${n++}.md`;
      }
      file = await this.app.vault.create(filePath, "");
      await setCollabId(this.app, file, uuid);
      debug(`joinSession: created new file ${filePath}`);
    } else {
      debug(`joinSession: found existing file ${file.path}`);
    }

    // Open file in editor
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    // Ensure state entry
    if (!this.collabFiles.has(file.path)) {
      this.collabFiles.set(file.path, { uuid, state: "offline", peerCount: 0 });
    }

    const session = new WebRTCSession(
      this.app,
      file,
      uuid,
      roomCode,
      this.settings
    );

    const filePath = file.path;
    session.on("peers", (count) => {
      const i = this.collabFiles.get(filePath);
      if (i) {
        i.peerCount = count;
        this.updateHeaderButtonsForFile(file!);
      }
    });

    const info = this.collabFiles.get(file.path)!;
    info.session = session;
    info.roomCode = roomCode;
    info.state = "live";
    info.peerCount = 0;

    this.syncHeaderButtons();
    new Notice(`Joined room: ${roomCode}`);
    log(`joinSession: connected to ${file.path} room=${roomCode}`);
  }

  // Discover the UUID for a room code by listening to peer awareness
  private discoverUuid(roomCode: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const tempDoc = new Y.Doc();
      const tempProvider = new WebrtcProvider(roomCode, tempDoc, {
        signaling: [this.settings.signalingUrl],
      });

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout: no host found in room (10s)"));
      }, 10_000);

      const cleanup = () => {
        clearTimeout(timer);
        tempProvider.awareness.off("change", check);
        tempProvider.destroy();
        tempDoc.destroy();
      };

      const check = () => {
        for (const [, state] of tempProvider.awareness.getStates()) {
          const uuid = (state as any).docMeta?.uuid;
          if (uuid) {
            cleanup();
            resolve(uuid);
            return;
          }
        }
      };

      tempProvider.awareness.on("change", check);
    });
  }

  // --- Header buttons ---

  syncHeaderButtons() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const view = leaf.view as MarkdownView;

      if (!this.headerButtons.has(view)) {
        const btn = view.addAction("radio-tower", "Collaboration", () => {
          const f = view.file;
          if (f) this.onHeaderButtonClick(f);
        });
        this.headerButtons.set(view, btn);
      }

      this.updateHeaderButton(view);
    });
  }

  private updateHeaderButton(view: MarkdownView) {
    const btn = this.headerButtons.get(view);
    if (!btn) return;

    const file = view.file;
    if (!file) {
      btn.style.display = "none";
      return;
    }

    const uuid = getCollabId(this.app, file);
    btn.style.display = "";

    if (!uuid) {
      setIcon(btn, "users");
      btn.ariaLabel = "Make Collaborative";
    } else {
      const info = this.collabFiles.get(file.path);
      const state: CollabState = info?.state ?? "offline";
      setIcon(btn, stateIcon(state));
      btn.ariaLabel = stateTooltip(state, info?.peerCount ?? 0);
    }
  }

  private updateHeaderButtonsForFile(file: TFile) {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (
        leaf.view instanceof MarkdownView &&
        leaf.view.file?.path === file.path
      ) {
        this.updateHeaderButton(leaf.view as MarkdownView);
      }
    });
  }

  private onHeaderButtonClick(file: TFile) {
    const uuid = getCollabId(this.app, file);
    if (!uuid) {
      this.makeCollaborative(file);
      return;
    }
    const info = this.collabFiles.get(file.path);
    const state: CollabState = info?.state ?? "offline";
    if (state === "offline") {
      this.goOnline(file);
    } else if (state === "live") {
      this.goOffline(file);
    }
  }

  // --- Helpers ---

  private setFileState(filePath: string, state: CollabState) {
    const info = this.collabFiles.get(filePath);
    if (!info) return;
    info.state = state;
    // Update buttons for any view showing this file
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      this.updateHeaderButtonsForFile(file);
    }
  }

  private ensureSettingsIdentity() {
    let changed = false;
    if (!this.settings.userName) {
      this.settings.userName = generateName();
      changed = true;
    }
    if (!this.settings.userColor) {
      this.settings.userColor = colorForPeerIndex(0);
      changed = true;
    }
    if (changed) this.saveSettings().catch(() => {});
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    setDebug(this.settings.debugLogging);
    await this.saveData(this.settings);
  }
}
