import { App, TFile, debounce } from "obsidian";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { loadYjsState, saveYjsState } from "./persistence";
import { log, debug, warn } from "./log";
import type { CRDTCoEditorSettings } from "./settings";
import type { CollabState } from "./collab-state";

/** Strip YAML frontmatter block so ytext only holds document body. */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  const after = end + 4; // skip past '\n---'
  return content[after] === "\n" ? content.slice(after + 1) : content.slice(after);
}

/** Extract the YAML frontmatter block (including trailing newline), or "". */
function extractFrontmatter(content: string): string {
  if (!content.startsWith("---")) return "";
  const end = content.indexOf("\n---", 3);
  if (end === -1) return "";
  const after = end + 4;
  return content[after] === "\n" ? content.slice(0, after + 1) : content.slice(0, after);
}

type EventMap = {
  "state-change": CollabState;
  peers: number;
};

/**
 * Manages a single Y.Doc ↔ WebRTC session for one collaborative file.
 *
 * Bootstrap ordering:
 *   1. Load Yjs state from UUID-keyed plugin folder
 *   2. If Yjs is empty → seed from .md content
 *   3. If Yjs matches .md → normal resumption
 *   4. If Yjs ≠ .md → warn and use Yjs (diff-apply deferred)
 */
export class WebRTCSession {
  ydoc: Y.Doc;
  ytext: Y.Text;
  provider: WebrtcProvider;
  private _selfWriteUntil = 0;
  private _destroyed = false;
  readonly whenReady: Promise<void>;

  private listeners = new Map<string, Function[]>();

  private debouncedWriteMarkdown = debounce(
    () => this.writeMarkdownFile(),
    1000,
    true
  );

  constructor(
    private app: App,
    private file: TFile,
    readonly uuid: string,
    roomCode: string,
    private settings: CRDTCoEditorSettings
  ) {
    log(`WebRTCSession created: ${file.path} uuid=${uuid} room=${roomCode}`);

    this.ydoc = new Y.Doc();
    this.ydoc.gc = true;
    this.ytext = this.ydoc.getText("content");

    this.provider = new WebrtcProvider(roomCode, this.ydoc, {
      signaling: [this.settings.signalingUrl],
    });

    this.provider.awareness.setLocalStateField("user", {
      name: this.settings.userName,
      color: this.settings.userColor,
    });

    // Advertise document identity so joiners can discover the UUID
    this.provider.awareness.setLocalStateField("docMeta", {
      uuid,
      filename: file.name,
    });

    this.provider.awareness.on("change", () => {
      const count = this.provider.awareness.getStates().size - 1; // exclude self
      this.emit("peers", Math.max(0, count));
    });

    this.ytext.observe(() => {
      if (!this._destroyed) {
        this.debouncedWriteMarkdown();
      }
    });

    this.whenReady = this.bootstrap();
  }

  on<K extends keyof EventMap>(
    event: K,
    cb: (data: EventMap[K]) => void
  ): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb as Function);
    this.listeners.set(event, arr);
  }

  private emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(data);
  }

  private async bootstrap(): Promise<void> {
    debug(`bootstrap(${this.file.path}) uuid=${this.uuid}`);

    const raw = await this.app.vault.read(this.file);
    const body = stripFrontmatter(raw);

    const loaded = await loadYjsState(this.app, this.uuid, this.ydoc);

    if (loaded && this.ytext.length > 0) {
      // ytext may contain FM if yCollab previously synced it from the editor; strip before comparing
      if (stripFrontmatter(this.ytext.toString()) === body) {
        debug(`bootstrap: Yjs matches disk, resuming`);
      } else {
        warn(
          `bootstrap: Yjs differs from disk for ${this.file.path} — using Yjs state (diff-apply deferred)`
        );
      }
      return;
    }

    if (body.length > 0) {
      debug(`bootstrap: seeding from .md body (${body.length} chars)`);
      this.ydoc.transact(() => {
        this.ytext.insert(0, body);
      });
    } else {
      debug(`bootstrap: empty doc, waiting for peers`);
    }
  }

  private async writeMarkdownFile(): Promise<void> {
    if (this._destroyed) return;

    // yCollab may sync frontmatter from the Obsidian editor into ytext — always strip it.
    // Read FM fresh from disk so we never lose it and never duplicate it.
    const current = await this.app.vault.read(this.file);
    const fm = extractFrontmatter(current);
    const body = stripFrontmatter(this.ytext.toString());
    const content = fm + body;

    // No-op guard: if nothing changed, skip the write entirely.
    // This breaks the FM-duplication loop: writing FM+body → editor reload → yCollab
    // inserts FM into ytext → we strip it here → same content → no write → loop stops.
    if (content === current) {
      await saveYjsState(this.app, this.uuid, this.ydoc);
      return;
    }

    this._selfWriteUntil = Date.now() + 500;
    await this.app.vault.modify(this.file, content);
    await saveYjsState(this.app, this.uuid, this.ydoc);
  }

  async flushAndSave(): Promise<void> {
    this.debouncedWriteMarkdown.cancel?.();
    await this.writeMarkdownFile();
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
