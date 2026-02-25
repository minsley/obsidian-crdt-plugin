import { Vault, TFile, debounce } from "obsidian";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { loadYjsState, saveYjsState } from "./persistence";
import { log, debug } from "./log";
import type { CRDTCoEditorSettings } from "./settings";

/**
 * Manages a single Y.Doc ↔ WebRTC session for one file.
 *
 * Bootstrap ordering (immediate, no server sync needed):
 *   1. Local .yjs file exists → load from it
 *   2. Neither → seed from .md file content
 *
 * When remote peers connect, Yjs CRDT merge reconciles state automatically.
 */
export class WebRTCSession {
  ydoc: Y.Doc;
  ytext: Y.Text;
  provider: WebrtcProvider;
  private _selfWriteUntil = 0;
  private _destroyed = false;
  readonly whenReady: Promise<void>;

  private debouncedWriteMarkdown = debounce(
    () => this.writeMarkdownFile(),
    1000,
    true
  );

  constructor(
    private vault: Vault,
    private file: TFile,
    roomName: string,
    private settings: CRDTCoEditorSettings
  ) {
    log(`WebRTCSession created: ${file.path} → room ${roomName}`);

    this.ydoc = new Y.Doc();
    this.ydoc.gc = true;
    this.ytext = this.ydoc.getText("content");

    this.provider = new WebrtcProvider(roomName, this.ydoc, {
      signaling: [this.settings.signalingUrl],
    });

    this.provider.awareness.setLocalStateField("user", {
      name: this.settings.userName,
      color: this.settings.userColor,
    });

    this.ytext.observe(() => {
      if (!this._destroyed) {
        this.debouncedWriteMarkdown();
      }
    });

    // Bootstrap immediately — no server sync gate needed.
    // When remote peers connect, Yjs applies their updates automatically.
    this.whenReady = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    debug(`bootstrap(${this.file.path})`);

    const loaded = await loadYjsState(this.vault, this.file.path, this.ydoc);
    if (loaded && this.ytext.length > 0) {
      debug(`bootstrap(${this.file.path}): loaded from .yjs`);
      return;
    }

    const markdown = await this.vault.read(this.file);
    if (markdown.length > 0) {
      debug(`bootstrap(${this.file.path}): seeding from .md (${markdown.length} chars)`);
      this.ydoc.transact(() => {
        this.ytext.insert(0, markdown);
      });
    } else {
      debug(`bootstrap(${this.file.path}): empty doc, waiting for peers`);
    }
  }

  private async writeMarkdownFile(): Promise<void> {
    if (this._destroyed) return;
    const content = this.ytext.toString();
    this._selfWriteUntil = Date.now() + 500;
    await this.vault.modify(this.file, content);
    await saveYjsState(this.vault, this.file.path, this.ydoc);
  }

  get isSelfWrite(): boolean {
    return Date.now() < this._selfWriteUntil;
  }

  destroy(): void {
    debug(`[${this.file.path}] WebRTCSession destroyed`);
    this._destroyed = true;
    this.debouncedWriteMarkdown.cancel?.();
    this.provider.awareness.setLocalState(null);
    this.provider.disconnect();
    this.provider.destroy();
    this.ydoc.destroy();
  }
}
