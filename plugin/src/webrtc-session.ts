import { App, TFile, debounce } from "obsidian";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { loadYjsState, saveYjsState } from "./persistence";
import { applyDiffToYText } from "./diff-apply";
import { log, debug, warn } from "./log";
import type { CRDTCoEditorSettings } from "./settings";
import type { CollabState } from "./collab-state";

/**
 * Find the index just past the closing `---\n` of a YAML frontmatter block.
 * Returns 0 if there is no valid frontmatter.
 *
 * Rules:
 * - File must start with `---` followed by \n or \r\n
 * - Closing `---` must be at the start of a line (not inside a value)
 * - Handles CRLF line endings
 */
export function frontmatterEndIndex(content: string): number {
  // Must start with --- followed by newline
  if (!content.startsWith("---")) return 0;
  const firstNl = content.indexOf("\n");
  if (firstNl === -1) return 0;
  // The opening line must be just `---` (possibly with \r)
  const opening = content.slice(0, firstNl);
  if (opening !== "---" && opening !== "---\r") return 0;

  // Search for closing --- at start of a line
  let i = firstNl + 1;
  while (i < content.length) {
    const lineEnd = content.indexOf("\n", i);
    const line =
      lineEnd === -1 ? content.slice(i) : content.slice(i, lineEnd);
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed === "---") {
      // Return index just past closing ---\n (or end of string)
      return lineEnd === -1 ? content.length : lineEnd + 1;
    }
    if (lineEnd === -1) break;
    i = lineEnd + 1;
  }
  return 0; // no closing --- found
}

/** Strip YAML frontmatter block(s) so ytext only holds document body. */
export function stripFrontmatter(content: string): string {
  let result = content;
  // Loop to strip multiple accumulated FM blocks (can happen from CRDT merge)
  let safety = 10;
  while (safety-- > 0) {
    const end = frontmatterEndIndex(result);
    if (end === 0) break;
    result = result.slice(end);
  }
  return result;
}

/** Extract the YAML frontmatter block (including trailing newline), or "". */
export function extractFrontmatter(content: string): string {
  const end = frontmatterEndIndex(content);
  return end === 0 ? "" : content.slice(0, end);
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
 *   4. If Yjs ≠ .md → diff-apply offline edits as Yjs operations
 */
export class WebRTCSession {
  ydoc: Y.Doc;
  ytext: Y.Text;
  provider!: WebrtcProvider;
  private _selfWriteUntil = 0;
  private _destroyed = false;
  private _isFirstTimeJoiner = false;
  readonly whenReady: Promise<void>;
  private _awarenessHandler!: () => void;
  private _ytextObserver!: () => void;

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
    private roomCode: string,
    private settings: CRDTCoEditorSettings
  ) {
    log(`WebRTCSession created: ${file.path} uuid=${uuid} room=${roomCode}`);

    this.ydoc = new Y.Doc();
    this.ydoc.gc = true;
    this.ytext = this.ydoc.getText("content");

    // Bootstrap loads local Yjs state and reconciles with disk BEFORE
    // starting WebRTC, so remote ops can't pollute the diff-apply comparison.
    this.whenReady = this.bootstrap().then(() => this.startProvider());
  }

  private startProvider() {
    if (this._destroyed) return;

    this.provider = new WebrtcProvider(this.roomCode, this.ydoc, {
      signaling: [this.settings.signalingUrl],
    });

    this.provider.awareness.setLocalStateField("user", {
      name: this.settings.userName,
      color: this.settings.userColor,
    });

    this.provider.awareness.setLocalStateField("docMeta", {
      uuid: this.uuid,
      filename: this.file.name,
    });

    this._awarenessHandler = () => {
      const count = this.provider.awareness.getStates().size - 1;
      this.emit("peers", Math.max(0, count));
    };
    this.provider.awareness.on("change", this._awarenessHandler);

    this._ytextObserver = () => {
      if (!this._destroyed) {
        this.debouncedWriteMarkdown();
      }
    };
    this.ytext.observe(this._ytextObserver);
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
        const ytextBody = stripFrontmatter(this.ytext.toString());
        debug(
          `bootstrap: Yjs differs from disk for ${this.file.path} — applying diff (${ytextBody.length} → ${body.length} chars)`
        );
        applyDiffToYText(this.ytext, ytextBody, body);
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
      this._isFirstTimeJoiner = true;
    }
  }

  private async writeMarkdownFile(): Promise<void> {
    if (this._destroyed) return;

    // With FM-aware ySync, ytext should never contain frontmatter.
    // Strip defensively for old Yjs state files that accumulated FM pre-migration.
    const current = await this.app.vault.read(this.file);
    const fm = extractFrontmatter(current);
    const raw = this.ytext.toString();
    const body = stripFrontmatter(raw);
    if (body !== raw) {
      debug(`writeMarkdownFile: stripped FM from ytext (migration from old state)`);
    }
    const content = fm + body;

    // No-op guard: skip write if content hasn't changed.
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

  waitForContent(): Promise<void> {
    if (!this._isFirstTimeJoiner || this.ytext.length > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.ytext.unobserve(obs);
        debug(`waitForContent: timeout (5s), proceeding with empty doc`);
        resolve();
      }, 5000);
      const obs = () => {
        if (this.ytext.length > 0) {
          clearTimeout(timeout);
          this.ytext.unobserve(obs);
          debug(`waitForContent: content arrived (${this.ytext.length} chars)`);
          resolve();
        }
      };
      this.ytext.observe(obs);
    });
  }

  get isSelfWrite(): boolean {
    return Date.now() < this._selfWriteUntil;
  }

  destroy(): void {
    debug(`[${this.file.path}] WebRTCSession destroyed`);
    this._destroyed = true;
    this.debouncedWriteMarkdown.cancel?.();
    if (this._ytextObserver) {
      this.ytext.unobserve(this._ytextObserver);
    }
    if (this.provider) {
      this.provider.awareness.off("change", this._awarenessHandler);
      this.provider.awareness.setLocalState(null);
      this.provider.disconnect();
      this.provider.destroy();
    }
    this.ydoc.destroy();
  }
}
