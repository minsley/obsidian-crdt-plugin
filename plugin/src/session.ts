import { Vault, TFile, debounce } from "obsidian";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { loadYjsState, saveYjsState } from "./persistence";
import { log, debug } from "./log";
import type { CRDTCoEditorSettings } from "./settings";

/**
 * Manages a single Y.Doc ↔ WebSocket session for one file.
 *
 * Bootstrap ordering (after provider 'sync' fires):
 *   1. Server has Yjs state → use it (sync handles this automatically)
 *   2. No server state, local .yjs file exists → load from .yjs
 *   3. Neither → seed from .md file content
 */
export class CRDTSession {
  ydoc: Y.Doc;
  ytext: Y.Text;
  provider: WebsocketProvider;
  private _selfWriteUntil = 0;
  private _destroyed = false;
  private _ready = false;
  private _readyResolve!: () => void;
  readonly whenReady: Promise<void>;

  private debouncedWriteMarkdown = debounce(
    () => this.writeMarkdownFile(),
    1000,
    true
  );

  constructor(
    private vault: Vault,
    private file: TFile,
    private vaultName: string,
    private settings: CRDTCoEditorSettings,
    explicitRoom?: string
  ) {
    this.whenReady = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });

    const roomName = explicitRoom || `obsidian/${this.vaultName}/${this.file.path}`;
    log(`Session created: ${file.path} → room ${roomName}`);

    this.ydoc = new Y.Doc();
    this.ydoc.gc = true;
    this.ytext = this.ydoc.getText("content");

    this.provider = new WebsocketProvider(
      this.settings.serverUrl,
      roomName,
      this.ydoc
    );

    this.provider.awareness.setLocalStateField("user", {
      name: this.settings.userName,
      color: this.settings.userColor,
    });

    this.provider.on("status", ({ status }: { status: string }) => {
      debug(`[${this.file.path}] provider status: ${status}`);
    });

    // y-websocket emits 'sync' with a plain boolean.
    this.provider.on("sync", (isSynced: boolean) => {
      debug(`[${this.file.path}] provider sync: ${isSynced}`);
      if (isSynced) {
        this.bootstrap();
      }
    });

    this.ytext.observe(() => {
      if (!this._destroyed) {
        this.debouncedWriteMarkdown();
      }
    });
  }

  private async bootstrap(): Promise<void> {
    debug(`bootstrap(${this.file.path}): ytext.length=${this.ytext.length}`);

    if (this.ytext.length > 0) {
      debug(`bootstrap(${this.file.path}): CASE 1 — server had state`);
      this.markReady();
      return;
    }

    const loaded = await loadYjsState(this.vault, this.file.path, this.ydoc);
    if (loaded && this.ytext.length > 0) {
      debug(`bootstrap(${this.file.path}): CASE 2 — loaded from .yjs file`);
      this.markReady();
      return;
    }

    const markdown = await this.vault.read(this.file);
    debug(
      `bootstrap(${this.file.path}): CASE 3 — seeding from .md (${markdown.length} chars)`
    );
    if (markdown.length > 0) {
      this.ydoc.transact(() => {
        this.ytext.insert(0, markdown);
      });
    }

    this.markReady();
  }

  private markReady() {
    debug(`[${this.file.path}] ready`);
    this._ready = true;
    this._readyResolve();
  }

  private async writeMarkdownFile(): Promise<void> {
    if (this._destroyed) return;
    const content = this.ytext.toString();
    this._selfWriteUntil = Date.now() + 500;
    await this.vault.modify(this.file, content);
    await saveYjsState(this.vault, this.file.path, this.ydoc);
  }

  get isSelfWrite(): boolean {
    return !this._ready || Date.now() < this._selfWriteUntil;
  }

  destroy(): void {
    debug(`[${this.file.path}] session destroyed`);
    this._destroyed = true;
    this.debouncedWriteMarkdown.cancel?.();
    this.provider.awareness.setLocalState(null);
    this.provider.disconnect();
    this.provider.destroy();
    this.ydoc.destroy();
  }
}
