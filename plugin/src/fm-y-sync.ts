import { ViewPlugin, EditorView, ViewUpdate } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { ySyncFacet } from "y-codemirror.next";
import { ySyncAnnotation } from "y-codemirror.next/src/y-sync.js";
import * as Y from "yjs";
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
  private _savedRelPos: { anchor: Y.RelativePosition; head: Y.RelativePosition } | null = null;

  private _beforeTxn = (txn: Y.Transaction) => {
    if (txn.origin === this.conf) return;
    const fmEnd = this.view.state.field(fmEndField);
    const sel = this.view.state.selection.main;
    const anchorIdx = Math.max(0, sel.anchor - fmEnd);
    const headIdx = Math.max(0, sel.head - fmEnd);
    this._savedRelPos = {
      anchor: Y.createRelativePositionFromTypeIndex(this._ytext, anchorIdx),
      head: Y.createRelativePositionFromTypeIndex(this._ytext, headIdx),
    };
  };

  private _observer = (event: any, tr: any) => {
    if (!this._ytext.doc) return;
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

        if (this._savedRelPos) {
          const newFmEnd = this.view.state.field(fmEndField);
          const doc = this._ytext.doc!;
          const anchorAbs = Y.createAbsolutePositionFromRelativePosition(this._savedRelPos.anchor, doc);
          const headAbs = Y.createAbsolutePositionFromRelativePosition(this._savedRelPos.head, doc);
          if (anchorAbs && headAbs) {
            const docLen = this.view.state.doc.length;
            const anchor = Math.min(anchorAbs.index + newFmEnd, docLen);
            const head = Math.min(headAbs.index + newFmEnd, docLen);
            this.view.dispatch({
              selection: EditorSelection.single(anchor, head),
              annotations: [ySyncAnnotation.of(this.conf)],
            });
          }
          this._savedRelPos = null;
        }
      }
    }
  };

  constructor(private view: EditorView) {
    this._ytext.doc!.on("beforeTransaction", this._beforeTxn);
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
    if (!ytext.doc) return;
    const fmEnd = update.startState.field(fmEndField);

    ytext.doc.transact(() => {
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
    this._ytext.doc?.off("beforeTransaction", this._beforeTxn);
    this._ytext.unobserve(this._observer);
  }
}

export const fmAwareYSync = ViewPlugin.fromClass(FmAwareYSyncValue);
