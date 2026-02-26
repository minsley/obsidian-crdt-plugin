import * as Y from "yjs";
import diff from "fast-diff";

/**
 * Apply a character-level diff between oldText and newText as Yjs operations
 * on ytext, so offline edits merge into CRDT history.
 */
export function applyDiffToYText(
  ytext: Y.Text,
  oldText: string,
  newText: string
): void {
  const changes = diff(oldText, newText);

  ytext.doc!.transact(() => {
    let pos = 0;
    for (const [type, text] of changes) {
      if (type === diff.EQUAL) {
        pos += text.length;
      } else if (type === diff.DELETE) {
        ytext.delete(pos, text.length);
      } else if (type === diff.INSERT) {
        ytext.insert(pos, text);
        pos += text.length;
      }
    }
  });
}
