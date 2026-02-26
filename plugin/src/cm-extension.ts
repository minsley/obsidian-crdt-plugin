import { ViewPlugin, ViewUpdate, EditorView, keymap } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { ySyncFacet, YSyncConfig, yUndoManagerKeymap } from "y-codemirror.next";
import {
  yUndoManagerFacet,
  YUndoManagerConfig,
  yUndoManager,
  undo,
  redo,
} from "y-codemirror.next/src/y-undomanager.js";
import * as Y from "yjs";
import { debug } from "./log";
import type CRDTCoEditorPlugin from "./main";
import type { WebRTCSession } from "./webrtc-session";
import { fmEndField, frontmatterEndIndex } from "./fm-offset";
import { fmAwareYSync } from "./fm-y-sync";
import {
  fmRemoteSelectionsTheme,
  fmAwareRemoteSelections,
} from "./fm-remote-selections";

/**
 * CM6 extension that dynamically binds the correct Y.Text per editor view
 * using a Compartment for clean attach/detach.
 */
export function createCollabExtension(plugin: CRDTCoEditorPlugin) {
  const compartment = new Compartment();

  const watcherPlugin = ViewPlugin.fromClass(
    class {
      private currentPath: string | null = null;
      private currentSession: WebRTCSession | null = null;
      private checkPending = false;

      constructor(private view: EditorView) {
        debug("[cm] ViewPlugin created");
        queueMicrotask(() => this.syncSession());
      }

      update(_update: ViewUpdate) {
        if (!this.checkPending) {
          this.checkPending = true;
          queueMicrotask(() => {
            this.checkPending = false;
            this.syncSession();
          });
        }
      }

      private syncSession() {
        const filePath = this.resolveFilePath();
        const session = filePath
          ? plugin.collabFiles.get(filePath)?.session ?? null
          : null;

        // Detect session change (offline→host creates new session on same path)
        if (session !== this.currentSession) {
          if (this.currentSession) {
            debug(`[cm] session changed for ${filePath}, detaching old`);
            this.detach();
          }
          this.currentSession = session;
          if (session && filePath) {
            this.currentPath = filePath;
            this.waitAndAttach(session, filePath);
            return;
          }
        }

        if (filePath === this.currentPath) {
          if (filePath && !this.hasActiveCollab() && session) {
            debug(`[cm] found new session for ${filePath}`);
            this.waitAndAttach(session, filePath);
          }
          return;
        }

        debug(`[cm] path changed: ${this.currentPath} → ${filePath}`);
        this.currentPath = filePath;

        if (!filePath) {
          this.detach();
          return;
        }

        if (session) {
          this.waitAndAttach(session, filePath);
        } else {
          this.detach();
        }
      }

      private waitAndAttach(session: WebRTCSession, filePath: string) {
        debug(`[cm] waitAndAttach(${filePath})`);
        session.whenReady.then(() => {
          if (this.currentPath === filePath && this.currentSession === session && !this.hasActiveCollab()) {
            this.attachSession(session, filePath);
          }
        });
      }

      private resolveFilePath(): string | null {
        const leaves = plugin.app.workspace.getLeavesOfType("markdown");
        for (const leaf of leaves) {
          // @ts-expect-error — accessing internal CM EditorView
          const cm = leaf.view?.editor?.cm as EditorView | undefined;
          if (cm === this.view) {
            // @ts-expect-error — accessing file from MarkdownView
            return leaf.view?.file?.path ?? null;
          }
        }
        return null;
      }

      private attachSession(
        session: { ytext: Y.Text; provider: { awareness: any } },
        filePath: string
      ) {
        const ySyncConfig = new YSyncConfig(
          session.ytext,
          session.provider.awareness
        );
        const undoManager = new Y.UndoManager(session.ytext);
        const extensions = [
          fmEndField,
          ySyncFacet.of(ySyncConfig),
          fmAwareYSync,
          fmRemoteSelectionsTheme,
          fmAwareRemoteSelections,
          yUndoManagerFacet.of(new YUndoManagerConfig(undoManager)),
          yUndoManager,
          EditorView.domEventHandlers({
            beforeinput(e: InputEvent, view: EditorView) {
              if (e.inputType === "historyUndo") return undo(view);
              if (e.inputType === "historyRedo") return redo(view);
              return false;
            },
          }),
          keymap.of(yUndoManagerKeymap),
        ];

        // Compare only the body (after frontmatter) to ytext.
        // Use frontmatterEndIndex directly since fmEndField isn't in
        // the state yet (it gets added in the reconfigure below).
        const editorDoc = this.view.state.doc.toString();
        const fmEnd = frontmatterEndIndex(editorDoc);
        const editorBody = editorDoc.slice(fmEnd);
        const ytextContent = session.ytext.toString();
        debug(
          `[cm] attachSession(${filePath}): ytext=${ytextContent.length}, body=${editorBody.length}, match=${editorBody === ytextContent}`
        );

        if (editorBody !== ytextContent) {
          debug(`[cm] replacing editor body with ytext`);
          this.view.dispatch({
            changes: {
              from: fmEnd,
              to: editorDoc.length,
              insert: ytextContent,
            },
          });
        }

        this.view.dispatch({
          effects: compartment.reconfigure(extensions),
        });
        debug(`[cm] FM-aware yCollab attached for ${filePath}`);
      }

      private detach() {
        this.currentSession = null;
        if (this.hasActiveCollab()) {
          debug("[cm] detaching yCollab");
          this.view.dispatch({
            effects: compartment.reconfigure([]),
          });
        }
      }

      private hasActiveCollab(): boolean {
        const value = compartment.get(this.view.state);
        // compartment.of([]) initializes with an empty array, so we need
        // to check length — an empty array means no yCollab is attached.
        return Array.isArray(value) ? value.length > 0 : value !== undefined;
      }

      destroy() {
        debug("[cm] ViewPlugin destroyed");
      }
    }
  );

  return [compartment.of([]), watcherPlugin];
}
