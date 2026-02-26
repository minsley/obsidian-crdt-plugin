import { StateField, EditorState } from "@codemirror/state";

/**
 * Find the character index just past the closing `---\n` of YAML frontmatter.
 * Returns 0 if no valid frontmatter block exists.
 *
 * Works on the CM6 Text type (via sliceString) to avoid materialising the
 * whole document string.  Since frontmatter is always at the top of the file
 * we only need to read the first few lines.
 */
export function frontmatterEndIndex(doc: { toString(): string }): number {
  const text = doc.toString();
  if (!text.startsWith("---")) return 0;

  const firstNl = text.indexOf("\n");
  if (firstNl === -1) return 0;
  const opening = text.slice(0, firstNl);
  if (opening !== "---" && opening !== "---\r") return 0;

  let i = firstNl + 1;
  while (i < text.length) {
    const lineEnd = text.indexOf("\n", i);
    const line = lineEnd === -1 ? text.slice(i) : text.slice(i, lineEnd);
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed === "---") {
      return lineEnd === -1 ? text.length : lineEnd + 1;
    }
    if (lineEnd === -1) break;
    i = lineEnd + 1;
  }
  return 0;
}

/**
 * CM6 StateField that tracks the character offset where frontmatter ends.
 * Value is 0 when there's no frontmatter.
 */
export const fmEndField = StateField.define<number>({
  create(state: EditorState) {
    return frontmatterEndIndex(state.doc);
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    return frontmatterEndIndex(tr.newDoc);
  },
});
