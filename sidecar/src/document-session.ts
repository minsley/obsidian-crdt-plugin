import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

/**
 * High-level editing API over a Y.Text for use by MCP tools.
 */
export class AgentDocumentSession {
  constructor(
    private ytext: Y.Text,
    private awareness: Awareness
  ) {}

  read(): string {
    return this.ytext.toString();
  }

  replace(
    search: string,
    replacement: string,
    occurrence: number | "all" = 1
  ): { success: boolean; position?: number; count?: number } {
    const content = this.ytext.toString();

    if (occurrence === "all") {
      let count = 0;
      let offset = 0;
      // Work backwards to avoid index shifting
      const positions: { start: number; len: number }[] = [];
      let idx = content.indexOf(search);
      while (idx !== -1) {
        positions.push({ start: idx, len: search.length });
        idx = content.indexOf(search, idx + search.length);
      }

      if (positions.length === 0) return { success: false, count: 0 };

      this.ytext.doc!.transact(() => {
        // Apply replacements in reverse order to preserve indices
        for (let i = positions.length - 1; i >= 0; i--) {
          const { start, len } = positions[i];
          this.ytext.delete(start, len);
          this.ytext.insert(start, replacement);
        }
      });

      return { success: true, count: positions.length };
    }

    // Find the nth occurrence
    let idx = -1;
    let found = 0;
    let searchFrom = 0;
    while (found < occurrence) {
      idx = content.indexOf(search, searchFrom);
      if (idx === -1) return { success: false };
      found++;
      searchFrom = idx + search.length;
    }

    this.ytext.doc!.transact(() => {
      this.ytext.delete(idx, search.length);
      this.ytext.insert(idx, replacement);
    });

    this.setPresence(idx + replacement.length);
    return { success: true, position: idx };
  }

  insertAfterPattern(
    pattern: string,
    text: string
  ): { success: boolean; error?: string } {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (e) {
      return {
        success: false,
        error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const content = this.ytext.toString();
    const lines = content.split("\n");
    let charIndex = 0;

    for (const line of lines) {
      if (regex.test(line)) {
        const insertAt = charIndex + line.length + 1; // +1 for the \n
        const insertText = text.endsWith("\n") ? text : text + "\n";
        this.ytext.insert(Math.min(insertAt, this.ytext.length), insertText);
        this.setPresence(insertAt + insertText.length);
        return { success: true };
      }
      charIndex += line.length + 1; // +1 for \n
    }

    return { success: false, error: "Pattern not found in any line" };
  }

  insertAtPosition(index: number, text: string): void {
    this.ytext.insert(index, text);
    this.setPresence(index + text.length);
  }

  append(text: string): void {
    const len = this.ytext.length;
    this.ytext.insert(len, text);
    this.setPresence(len + text.length);
  }

  setPresence(cursor: number): void {
    this.awareness.setLocalStateField("cursor", { index: cursor });
  }
}
