import { Plugin, TFile, MarkdownView } from "obsidian";
import { CRDTSession } from "./session";
import { createCollabExtension } from "./cm-extension";
import { log, warn, setDebug } from "./log";
import {
  CRDTCoEditorSettings,
  CRDTCoEditorSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

export default class CRDTCoEditorPlugin extends Plugin {
  settings: CRDTCoEditorSettings = DEFAULT_SETTINGS;
  sessions = new Map<string, CRDTSession>();

  async onload() {
    await this.loadSettings();
    setDebug(this.settings.debugLogging);
    log("Plugin loaded");
    this.addSettingTab(new CRDTCoEditorSettingTab(this.app, this));

    // Register the CM6 collab extension (shared across all editors)
    this.registerEditorExtension(createCollabExtension(this));

    // Open session when a file is opened
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.openSession(file);
        }
      })
    );

    // Watch for external file modifications.
    // Compare file content against Y.Text to distinguish real external edits
    // from Obsidian's own auto-save (which writes editor content back to disk).
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

    // Clean up sessions when leaves change
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.cleanupStaleSessions();
      })
    );

    // Open session for currently active file on load
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === "md") {
      this.openSession(activeFile);
    }
  }

  async onunload() {
    for (const [, session] of this.sessions) {
      session.destroy();
    }
    this.sessions.clear();
  }

  private openSession(file: TFile) {
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

  private cleanupStaleSessions() {
    // Find which file paths are currently open in markdown leaves
    const openPaths = new Set<string>();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file) {
        openPaths.add(leaf.view.file.path);
      }
    });

    // Destroy sessions for files no longer open
    for (const [path, session] of this.sessions) {
      if (!openPaths.has(path)) {
        session.destroy();
        this.sessions.delete(path);
      }
    }
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
