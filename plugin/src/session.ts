import { Vault, TFile, debounce } from "obsidian";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { loadYjsState, saveYjsState } from "./persistence";
import type { CRDTCoEditorSettings } from "./settings";

/**
 * Manages a single Y.Doc ↔ WebSocket session for one file.
 *
 * Bootstrap ordering (after provider 'synced' fires):
 *   1. Server has Yjs state → use it (sync handles this automatically)
 *   2. No server state, local .yjs file exists → load from .yjs
 *   3. Neither → seed from .md file content
 */
export class CRDTSession {
  ydoc: Y.Doc;
  ytext: Y.Text;
  provider: WebsocketProvider;
  private _selfWrite = false;
  private _destroyed = false;

  private debouncedWriteMarkdown = debounce(
    () => this.writeMarkdownFile(),
    1000,
    true
  );

  constructor(
    private vault: Vault,
    private file: TFile,
    private vaultName: string,
    private settings: CRDTCoEditorSettings
  ) {
    this.ydoc = new Y.Doc();
    this.ydoc.gc = true;
    this.ytext = this.ydoc.getText("content");

    const roomName = `obsidian/${this.vaultName}/${this.file.path}`;
    this.provider = new WebsocketProvider(
      this.settings.serverUrl,
      roomName,
      this.ydoc
    );

    // Set awareness
    this.provider.awareness.setLocalStateField("user", {
      name: this.settings.userName,
      color: this.settings.userColor,
    });

    // Bootstrap once synced with server
    this.provider.on("synced", ({ synced }: { synced: boolean }) => {
      if (synced) {
        this.bootstrap();
      }
    });

    // Write .md file on Y.Text changes (debounced)
    this.ytext.observe(() => {
      if (!this._destroyed) {
        this.debouncedWriteMarkdown();
      }
    });
  }

  private async bootstrap(): Promise<void> {
    // If the server already provided content via sync, Y.Text will be non-empty.
    if (this.ytext.length > 0) {
      // Case 1: Server had state — nothing to do, sync already applied it.
      return;
    }

    // Case 2: Try loading from local .yjs file
    const loaded = await loadYjsState(this.vault, this.file.path, this.ydoc);
    if (loaded && this.ytext.length > 0) {
      return;
    }

    // Case 3: Seed from .md file
    const markdown = await this.vault.read(this.file);
    if (markdown.length > 0) {
      this.ydoc.transact(() => {
        this.ytext.insert(0, markdown);
      });
    }
  }

  private async writeMarkdownFile(): Promise<void> {
    if (this._destroyed) return;
    const content = this.ytext.toString();
    try {
      this._selfWrite = true;
      await this.vault.modify(this.file, content);
    } finally {
      this._selfWrite = false;
    }

    // Also persist Yjs binary state
    await saveYjsState(this.vault, this.file.path, this.ydoc);
  }

  /** Returns true if this write was triggered by the plugin itself (not external). */
  get isSelfWrite(): boolean {
    return this._selfWrite;
  }

  destroy(): void {
    this._destroyed = true;
    this.debouncedWriteMarkdown.cancel?.();
    this.provider.awareness.setLocalState(null);
    this.provider.disconnect();
    this.provider.destroy();
    this.ydoc.destroy();
  }
}
