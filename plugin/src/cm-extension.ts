import { ViewPlugin, ViewUpdate, EditorView, keymap } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import type CRDTCoEditorPlugin from "./main";

/**
 * CM6 extension that dynamically binds the correct Y.Text per editor view
 * using a Compartment for clean attach/detach.
 *
 * How it works:
 * - A Compartment holds the yCollab extensions (or empty [] when no session).
 * - A ViewPlugin watches which file this EditorView belongs to.
 * - When the file changes or a session becomes available, it reconfigures
 *   the compartment with fresh yCollab extensions.
 * - On detach, it reconfigures the compartment to [] which triggers
 *   destroy() on the yCollab ViewPlugins, cleaning up Y.Text observers.
 *
 * The UndoManager is created per-session and scoped to local changes only
 * (yCollab handles this internally by tracking the YSyncConfig as origin).
 */
export function createCollabExtension(plugin: CRDTCoEditorPlugin) {
  const compartment = new Compartment();

  const watcherPlugin = ViewPlugin.fromClass(
    class {
      private currentPath: string | null = null;
      private checkPending = false;

      constructor(private view: EditorView) {
        // Defer initial attach to next microtask so the compartment
        // has been added to the editor state first.
        queueMicrotask(() => this.syncSession());
      }

      update(_update: ViewUpdate) {
        // Check if the file this editor is showing has changed.
        // Obsidian can reuse an editor leaf for a different file.
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
          // Path unchanged — but session might have been created since last check
          if (filePath && !this.hasActiveCollab()) {
            const session = plugin.sessions.get(filePath);
            if (session) {
              this.attachSession(session, filePath);
            }
          }
          return;
        }

        // File changed — detach old, maybe attach new
        this.currentPath = filePath;

        if (!filePath) {
          this.detach();
          return;
        }

        const session = plugin.sessions.get(filePath);
        if (session) {
          this.attachSession(session, filePath);
        } else {
          this.detach();
        }
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
        _filePath: string
      ) {
        const undoManager = new Y.UndoManager(session.ytext);
        const extensions = [
          ...yCollab(session.ytext, session.provider.awareness, {
            undoManager,
          }),
          keymap.of(yUndoManagerKeymap),
        ];

        this.view.dispatch({
          effects: compartment.reconfigure(extensions),
        });
      }

      private detach() {
        // Reconfigure to empty — this destroys the yCollab ViewPlugins,
        // which call their destroy() methods and unobserve Y.Text.
        if (this.hasActiveCollab()) {
          this.view.dispatch({
            effects: compartment.reconfigure([]),
          });
        }
      }

      private hasActiveCollab(): boolean {
        // Check if the compartment currently has non-empty content
        return compartment.get(this.view.state) !== undefined;
      }

      destroy() {
        // ViewPlugin is being destroyed (editor closing)
        // No explicit detach needed — CM6 will destroy the compartment contents
      }
    }
  );

  // Return both the compartment (initially empty) and the watcher plugin.
  // registerEditorExtension gets this array, so every new editor gets both.
  return [compartment.of([]), watcherPlugin];
}
