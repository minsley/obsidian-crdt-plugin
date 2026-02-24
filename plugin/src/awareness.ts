import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import type { Awareness } from "y-protocols/awareness";

/**
 * Remote cursor presence rendering for CM6.
 *
 * Renders remote user cursors as colored widget decorations
 * at the reported character index.
 */

interface RemoteCursor {
  name: string;
  color: string;
  index: number;
}

class CursorWidget extends WidgetType {
  constructor(private name: string, private color: string) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "crdt-remote-cursor";
    el.style.borderLeft = `2px solid ${this.color}`;
    el.style.marginLeft = "-1px";
    el.style.position = "relative";

    const label = document.createElement("span");
    label.className = "crdt-remote-cursor-label";
    label.textContent = this.name;
    label.style.position = "absolute";
    label.style.bottom = "100%";
    label.style.left = "0";
    label.style.backgroundColor = this.color;
    label.style.color = "white";
    label.style.padding = "1px 4px";
    label.style.borderRadius = "3px 3px 3px 0";
    label.style.fontSize = "11px";
    label.style.lineHeight = "1.2";
    label.style.whiteSpace = "nowrap";
    label.style.pointerEvents = "none";

    el.appendChild(label);
    return el;
  }

  eq(other: CursorWidget): boolean {
    return this.name === other.name && this.color === other.color;
  }
}

const setCursorsEffect = StateEffect.define<RemoteCursor[]>();

const remoteCursorsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCursorsEffect)) {
        const decorations = effect.value
          .filter((c) => c.index >= 0 && c.index <= tr.state.doc.length)
          .sort((a, b) => a.index - b.index)
          .map((c) =>
            Decoration.widget({
              widget: new CursorWidget(c.name, c.color),
              side: 1,
            }).range(c.index)
          );
        return Decoration.set(decorations);
      }
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Creates a CM6 extension for rendering remote cursors.
 * Call updateCursors() whenever awareness state changes.
 */
export function createRemoteCursorsExtension() {
  return remoteCursorsField;
}

/**
 * Dispatch updated cursor positions into an EditorView.
 */
export function updateCursors(
  view: EditorView,
  awareness: Awareness,
  localClientId: number
): void {
  const cursors: RemoteCursor[] = [];

  awareness.getStates().forEach((state, clientId) => {
    if (clientId === localClientId) return;
    const user = state.user;
    const cursor = state.cursor;
    if (user && cursor && typeof cursor.index === "number") {
      cursors.push({
        name: user.name || "Unknown",
        color: user.color || "#888",
        index: cursor.index,
      });
    }
  });

  view.dispatch({ effects: setCursorsEffect.of(cursors) });
}
