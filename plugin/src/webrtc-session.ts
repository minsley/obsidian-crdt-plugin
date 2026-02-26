import { App, TFile, debounce } from "obsidian";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { loadYjsState, saveYjsState } from "./persistence";
import { applyDiffToYText } from "./diff-apply";
import { stripFrontmatter, extractFrontmatter } from "./fm-offset";
import { log, debug, warn } from "./log";
import type { CRDTCoEditorSettings } from "./settings";
import type { CollabState } from "./collab-state";

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
  private _lastWrittenContent: string | null = null;
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
    this.whenReady = this.bootstrap()
      .then(() => this.startProvider())
      .catch((err) => {
        warn(`Session bootstrap failed for ${file.path}: ${err}`);
        this.destroy();
        throw err;
      });
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
      // ytext may contain FM remnants from pre-migration yCollab; strip before comparing
      const ytextRaw = this.ytext.toString();
      const ytextBody = stripFrontmatter(ytextRaw);

      // If ytext has FM remnants, remove them so diff positions align
      if (ytextRaw !== ytextBody) {
        const fmLen = ytextRaw.length - ytextBody.length;
        debug(`bootstrap: stripping ${fmLen} chars of FM from ytext`);
        this.ydoc.transact(() => { this.ytext.delete(0, fmLen); });
      }

      if (ytextBody === body) {
        debug(`bootstrap: Yjs matches disk, resuming`);
      } else {
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

    this._lastWrittenContent = content;
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

  isSelfWrite(content: string): boolean {
    return this._lastWrittenContent === content;
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
