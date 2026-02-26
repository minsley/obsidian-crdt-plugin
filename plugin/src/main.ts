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
import { stripFrontmatter } from "./fm-offset";
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
import { deleteYjsState, readYjsStateRaw, saveYjsState } from "./persistence";
import { generateName, colorForPeerIndex } from "./identity";
import type { CollabState, FileCollabInfo } from "./collab-state";
import { OnlineModal, JoinModal } from "./online-modal";
import { UnlinkWarningModal } from "./unlink-modal";

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
    case "offline":      return "wifi-off";
    case "connecting":   return "loader";
    case "live":         return "radio-tower";
    case "disconnecting": return "loader";
  }
}

function stateTooltip(state: CollabState, peerCount = 0, userName?: string): string {
  switch (state) {
    case "offline":      return "Go Online";
    case "connecting":   return "Connecting...";
    case "live": {
      const youLabel = userName ? ` (you: ${userName})` : "";
      return `Live — ${peerCount} peer${peerCount !== 1 ? "s" : ""}${youLabel} (click to go offline)`;
    }
    case "disconnecting": return "Disconnecting...";
  }
}

export default class CRDTCoEditorPlugin extends Plugin {
  settings: CRDTCoEditorSettings = DEFAULT_SETTINGS;

  // Per-file collaboration state. Key = file.path
  collabFiles = new Map<string, FileCollabInfo>();

  // One header button per MarkdownView
  private headerButtons = new WeakMap<MarkdownView, HTMLElement>();

  // In-session unlink undo cache. Key = file.path
  private unlinkCaches = new Map<string, { uuid: string; yjsData: Uint8Array }>();

  private statusBarEl!: HTMLElement;

  async onload() {
    await this.loadSettings();
    setDebug(this.settings.debugLogging);
    log("Plugin loaded (WebRTC mode)");
    this.addSettingTab(new CRDTCoEditorSettingTab(this.app, this));

    this.registerEditorExtension(createCollabExtension(this));

    this.addRibbonIcon("users", "Join collaboration session", () => {
      new JoinModal(this.app, this).open();
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("collab-status-bar");

    this.addCommand({
      id: "join-session",
      name: "Join collaboration session",
      callback: () => new JoinModal(this.app, this).open(),
    });

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
          if (this.unlinkCaches.has(file.path)) {
            menu.addItem((item) =>
              item
                .setTitle("Restore Collaboration")
                .setIcon("undo")
                .onClick(() => this.restoreUnlink(file))
            );
          }
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

    // Migrate map entries when a file is renamed/moved
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const info = this.collabFiles.get(oldPath);
        if (info) {
          this.collabFiles.delete(oldPath);
          this.collabFiles.set(file.path, info);
        }
        const cache = this.unlinkCaches.get(oldPath);
        if (cache) {
          this.unlinkCaches.delete(oldPath);
          this.unlinkCaches.set(file.path, cache);
        }
      })
    );

    // Handle external file modifications while live
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile) {
          const info = this.collabFiles.get(file.path);
          if (info?.session) {
            const currentContent = await this.app.vault.read(file);
            if (info.session.isSelfWrite(currentContent)) return;
            const diskContent = stripFrontmatter(currentContent);
            const ytextContent = stripFrontmatter(info.session.ytext.toString());
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

    // Show warning modal unless user has dismissed it
    if (!this.settings.unlinkWarningDismissed) {
      const { proceed, dismiss } = await new UnlinkWarningModal(this.app).open();
      if (dismiss) {
        this.settings.unlinkWarningDismissed = true;
        await this.saveSettings();
      }
      if (!proceed) return;
    }

    const info = this.collabFiles.get(file.path);
    if (info?.session) {
      await this.goOffline(file);
    }

    // Cache Yjs state for in-session restore
    const yjsData = await readYjsStateRaw(this.app, uuid);
    if (yjsData) {
      this.unlinkCaches.set(file.path, { uuid, yjsData });
    }

    await removeCollabId(this.app, file);
    await deleteYjsState(this.app, uuid);
    this.collabFiles.delete(file.path);

    this.syncHeaderButtons();
    log(`unlinkFile: ${file.path} uuid=${uuid}`);

    // Offer restore via a 10-second notice
    const frag = document.createDocumentFragment();
    frag.appendText("Collaboration unlinked. ");
    const restoreLink = frag.createEl("a", { text: "Undo", href: "#" });
    restoreLink.addEventListener("click", (e) => {
      e.preventDefault();
      this.restoreUnlink(file);
    });
    new Notice(frag, 10000);
  }

  async restoreUnlink(file: TFile): Promise<void> {
    const cache = this.unlinkCaches.get(file.path);
    if (!cache) {
      new Notice("No unlink data to restore");
      return;
    }

    await setCollabId(this.app, file, cache.uuid);

    // Re-save the Yjs state by loading into a temp doc and saving
    const doc = new Y.Doc();
    Y.applyUpdate(doc, cache.yjsData);
    await saveYjsState(this.app, cache.uuid, doc);
    doc.destroy();

    this.collabFiles.set(file.path, {
      uuid: cache.uuid,
      state: "offline",
      peerCount: 0,
    });

    this.unlinkCaches.delete(file.path);
    this.syncHeaderButtons();
    new Notice("Collaboration restored");
    log(`restoreUnlink: ${file.path} uuid=${cache.uuid}`);
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
        this.updateStatusBar();
      }
    });

    const info = this.collabFiles.get(file.path)!;
    info.session = session;
    info.roomCode = roomCode;
    info.state = "connecting";
    info.peerCount = 0;

    this.syncHeaderButtons();

    session.whenReady.then(() => {
      if (info.state === "connecting") {
        info.state = "live";
        this.syncHeaderButtons();
      }
    });

    log(`beginHosting: ${file.path} room=${roomCode}`);
    return roomCode;
  }

  // Called by OnlineModal — join path
  // When knownFile is provided (returning joiner), skip awareness discovery.
  async joinSession(roomCode: string, knownFile?: TFile): Promise<void> {
    this.ensureSettingsIdentity();

    let file: TFile | null = knownFile ?? null;
    let fileCreated = false;
    let uuid: string | undefined;

    if (file) {
      uuid = getCollabId(this.app, file) ?? undefined;
    }

    if (uuid) {
      log(`joinSession: returning joiner uuid=${uuid} room=${roomCode}`);
    } else {
      const discovered = await this.discoverUuid(roomCode);
      uuid = discovered.uuid;

      // Validate UUID format to prevent path traversal
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new Error("Invalid UUID received from peer");
      }

      // Sanitize filename to prevent path traversal
      const safeName = discovered.filename
        .replace(/[\/\\]/g, "_")
        .replace(/\.\./g, "_");
      log(`joinSession: discovered uuid=${uuid} filename=${safeName} room=${roomCode}`);

      file = findFileByCollabId(this.app, uuid);
      if (!file) {
        const baseName = safeName.replace(/\.md$/, "");
        let filePath = `${baseName}.md`;
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(filePath)) {
          filePath = `${baseName}-${n++}.md`;
        }
        file = await this.app.vault.create(filePath, "");
        fileCreated = true;
        await setCollabId(this.app, file, uuid);
        debug(`joinSession: created new file ${filePath}`);
      } else {
        debug(`joinSession: found existing file ${file.path}`);
      }
    }

    if (!file || !uuid) {
      throw new Error("Could not determine file or UUID for join");
    }

    let session: WebRTCSession | undefined;

    try {
      // Open file in editor
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);

      // Ensure state entry
      if (!this.collabFiles.has(file.path)) {
        this.collabFiles.set(file.path, { uuid, state: "offline", peerCount: 0 });
      }

      session = new WebRTCSession(
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
          this.updateStatusBar();
        }
      });

      const info = this.collabFiles.get(file.path)!;
      info.session = session;
      info.roomCode = roomCode;
      info.state = "connecting";
      info.peerCount = 0;

      this.syncHeaderButtons();

      session.whenReady.then(() => {
        if (info.state === "connecting") {
          info.state = "live";
          this.syncHeaderButtons();
          new Notice(`Joined room: ${roomCode}`);
        }
      });

      log(`joinSession: connected to ${file.path} room=${roomCode}`);
    } catch (e) {
      warn(`joinSession failed: ${e}`);
      if (session) session.destroy();
      if (file) {
        this.collabFiles.delete(file.path);
        if (fileCreated) {
          await this.app.vault.delete(file).catch(() => {});
        }
      }
      throw e;
    }
  }

  // Discover the UUID and filename for a room code by listening to peer awareness
  private discoverUuid(
    roomCode: string
  ): Promise<{ uuid: string; filename: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const tempDoc = new Y.Doc();
      const tempProvider = new WebrtcProvider(roomCode, tempDoc, {
        signaling: [this.settings.signalingUrl],
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
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
        if (settled) return;
        for (const [, state] of tempProvider.awareness.getStates()) {
          const meta = (state as any).docMeta;
          if (meta?.uuid) {
            settled = true;
            cleanup();
            resolve({ uuid: meta.uuid, filename: meta.filename ?? meta.uuid });
            return;
          }
        }
      };

      tempProvider.awareness.on("change", check);
      // Check immediately in case awareness states are already populated
      check();
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
    this.updateStatusBar();
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

    // Clear previous state classes
    btn.removeClass("collab-state-offline", "collab-state-connecting", "collab-state-live", "collab-state-disconnecting");

    if (!uuid) {
      setIcon(btn, "users");
      btn.ariaLabel = "Make Collaborative";
    } else {
      const info = this.collabFiles.get(file.path);
      const state: CollabState = info?.state ?? "offline";
      setIcon(btn, stateIcon(state));
      btn.ariaLabel = stateTooltip(state, info?.peerCount ?? 0, this.settings.userName);
      btn.addClass(`collab-state-${state}`);
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
    this.updateStatusBar();
  }

  private updateStatusBar() {
    this.statusBarEl.empty();

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;

    const info = this.collabFiles.get(activeFile.path);
    if (!info || info.state !== "live") return;

    const dot = this.statusBarEl.createSpan({ cls: "collab-status-dot" });
    dot.style.backgroundColor = this.settings.userColor || "#888";

    this.statusBarEl.createSpan({
      cls: "collab-status-name",
      text: this.settings.userName || "Anonymous",
    });

    this.statusBarEl.createSpan({
      cls: "collab-status-peers",
      text: ` · ${info.peerCount} peer${info.peerCount !== 1 ? "s" : ""}`,
    });
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
