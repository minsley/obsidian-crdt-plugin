import { ViewPlugin, EditorView, ViewUpdate } from "@codemirror/view";
import { ySyncFacet } from "y-codemirror.next";
import { ySyncAnnotation } from "y-codemirror.next/src/y-sync.js";
import { fmEndField } from "./fm-offset";
import { debug } from "./log";

/**
 * FM-aware replacement for the ySync ViewPlugin from y-codemirror.next.
 *
 * The standard ySync binds the full CM6 editor document to ytext — which in
 * Obsidian includes YAML frontmatter as raw text. This version offsets all
 * positions by the frontmatter length so that ytext only ever contains the
 * document body (everything after the closing `---\n`).
 */
class FmAwareYSyncValue {
  private conf = this.view.state.facet(ySyncFacet);
  private _ytext = this.conf.ytext;

  private _observer = (event: any, tr: any) => {
    if (tr.origin !== this.conf) {
      const fmEnd = this.view.state.field(fmEndField);
      const delta = event.delta;
      const changes: { from: number; to: number; insert: string }[] = [];
      let pos = 0;
      for (let i = 0; i < delta.length; i++) {
        const d = delta[i];
        if (d.insert != null) {
          changes.push({ from: pos + fmEnd, to: pos + fmEnd, insert: d.insert });
        } else if (d.delete != null) {
          changes.push({
            from: pos + fmEnd,
            to: pos + d.delete + fmEnd,
            insert: "",
          });
          pos += d.delete;
        } else {
          pos += d.retain;
        }
      }
      if (changes.length > 0) {
        this.view.dispatch({
          changes,
          annotations: [ySyncAnnotation.of(this.conf)],
        });
      }
    }
  };

  constructor(private view: EditorView) {
    this._ytext.observe(this._observer);
  }

  update(update: ViewUpdate) {
    if (
      !update.docChanged ||
      (update.transactions.length > 0 &&
        update.transactions[0].annotation(ySyncAnnotation) === this.conf)
    ) {
      return;
    }

    const ytext = this.conf.ytext;
    const fmEnd = update.startState.field(fmEndField);

    ytext.doc!.transact(() => {
      let adj = 0;
      update.changes.iterChanges(
        (fromA: number, toA: number, _fromB: number, _toB: number, insert: any) => {
          const insertText = insert.sliceString(0, insert.length, "\n");

          // Skip changes entirely within the frontmatter region
          if (toA <= fmEnd) {
            return;
          }

          // Clamp changes that span the FM boundary
          const effectiveFrom = Math.max(fromA, fmEnd);
          const ytextFrom = effectiveFrom - fmEnd + adj;
          const deleteLen = toA - effectiveFrom;

          if (deleteLen > 0) {
            ytext.delete(ytextFrom, deleteLen);
          }
          if (insertText.length > 0) {
            ytext.insert(ytextFrom, insertText);
          }
          adj += insertText.length - deleteLen;
        }
      );
    }, this.conf);
  }

  destroy() {
    this._ytext.unobserve(this._observer);
  }
}

export const fmAwareYSync = ViewPlugin.fromClass(FmAwareYSyncValue);
