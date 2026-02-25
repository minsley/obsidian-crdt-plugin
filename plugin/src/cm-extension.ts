import { ViewPlugin, ViewUpdate, EditorView, keymap } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { debug } from "./log";
import type CRDTCoEditorPlugin from "./main";
import type { WebRTCSession } from "./webrtc-session";

/**
 * CM6 extension that dynamically binds the correct Y.Text per editor view
 * using a Compartment for clean attach/detach.
 */
export function createCollabExtension(plugin: CRDTCoEditorPlugin) {
  const compartment = new Compartment();

  const watcherPlugin = ViewPlugin.fromClass(
    class {
      private currentPath: string | null = null;
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

        if (filePath === this.currentPath) {
          if (filePath && !this.hasActiveCollab()) {
            const session = plugin.collabFiles.get(filePath)?.session;
            if (session) {
              debug(`[cm] found new session for ${filePath}`);
              this.waitAndAttach(session, filePath);
            }
          }
          return;
        }

        debug(`[cm] path changed: ${this.currentPath} → ${filePath}`);
        this.currentPath = filePath;

        if (!filePath) {
          this.detach();
          return;
        }

        const session = plugin.collabFiles.get(filePath)?.session;
        if (session) {
          this.waitAndAttach(session, filePath);
        } else {
          this.detach();
        }
      }

      private waitAndAttach(session: WebRTCSession, filePath: string) {
        debug(`[cm] waitAndAttach(${filePath})`);
        session.whenReady.then(() => {
          if (this.currentPath === filePath && !this.hasActiveCollab()) {
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
        const undoManager = new Y.UndoManager(session.ytext);
        const extensions = [
          ...yCollab(session.ytext, session.provider.awareness, {
            undoManager,
          }),
          keymap.of(yUndoManagerKeymap),
        ];

        const ytextContent = session.ytext.toString();
        const editorContent = this.view.state.doc.toString();
        debug(
          `[cm] attachSession(${filePath}): ytext=${ytextContent.length}, editor=${editorContent.length}, match=${editorContent === ytextContent}`
        );

        if (editorContent !== ytextContent) {
          debug(`[cm] replacing editor content with ytext`);
          this.view.dispatch({
            changes: {
              from: 0,
              to: editorContent.length,
              insert: ytextContent,
            },
          });
        }

        this.view.dispatch({
          effects: compartment.reconfigure(extensions),
        });
        debug(`[cm] yCollab attached for ${filePath}`);
      }

      private detach() {
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
