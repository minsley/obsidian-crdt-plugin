import {
  ViewPlugin,
  EditorView,
  ViewUpdate,
  WidgetType,
  Decoration,
} from "@codemirror/view";
import { Annotation, RangeSet, Range } from "@codemirror/state";
import * as Y from "yjs";
import { ySyncFacet } from "y-codemirror.next";
import { fmEndField } from "./fm-offset";

export const fmRemoteSelectionsTheme = EditorView.baseTheme({
  ".cm-ySelection": {},
  ".cm-yLineSelection": {
    padding: 0,
    margin: "0px 2px 0px 4px",
  },
  ".cm-ySelectionCaret": {
    position: "relative",
    borderLeft: "1px solid black",
    borderRight: "1px solid black",
    marginLeft: "-1px",
    marginRight: "-1px",
    boxSizing: "border-box",
    display: "inline",
  },
  ".cm-ySelectionCaretDot": {
    borderRadius: "50%",
    position: "absolute",
    width: ".4em",
    height: ".4em",
    top: "-.2em",
    left: "-.2em",
    backgroundColor: "inherit",
    transition: "transform .3s ease-in-out",
    boxSizing: "border-box",
  },
  ".cm-ySelectionCaret:hover > .cm-ySelectionCaretDot": {
    transformOrigin: "bottom center",
    transform: "scale(0)",
  },
  ".cm-ySelectionInfo": {
    position: "absolute",
    top: "-1.05em",
    left: "-1px",
    fontSize: ".75em",
    fontFamily: "serif",
    fontStyle: "normal",
    fontWeight: "normal",
    lineHeight: "normal",
    userSelect: "none",
    color: "white",
    paddingLeft: "2px",
    paddingRight: "2px",
    zIndex: 101,
    transition: "opacity .3s ease-in-out",
    backgroundColor: "inherit",
    opacity: 0,
    transitionDelay: "0s",
    whiteSpace: "nowrap",
  },
  ".cm-ySelectionCaret:hover > .cm-ySelectionInfo": {
    opacity: 1,
    transitionDelay: "0s",
  },
});

const yRemoteSelectionsAnnotation = Annotation.define<number[]>();

class YRemoteCaretWidget extends WidgetType {
  constructor(private color: string, private name: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ySelectionCaret";
    span.style.backgroundColor = this.color;
    span.style.borderColor = this.color;
    span.appendChild(document.createTextNode("\u2060"));

    const dot = document.createElement("div");
    dot.className = "cm-ySelectionCaretDot";
    span.appendChild(dot);

    span.appendChild(document.createTextNode("\u2060"));

    const info = document.createElement("div");
    info.className = "cm-ySelectionInfo";
    info.appendChild(document.createTextNode(this.name));
    span.appendChild(info);

    span.appendChild(document.createTextNode("\u2060"));
    return span;
  }

  eq(widget: YRemoteCaretWidget) {
    return widget.color === this.color && widget.name === this.name;
  }
}

class FmAwareRemoteSelectionsValue {
  private conf = this.view.state.facet(ySyncFacet);
  private _awareness = this.conf.awareness;
  decorations: RangeSet<Decoration> = RangeSet.of([]);

  private _listener = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const clients = added.concat(updated).concat(removed);
    if (
      clients.findIndex(
        (id: number) => id !== this.conf.awareness.doc.clientID
      ) >= 0
    ) {
      this.view.dispatch({
        annotations: [yRemoteSelectionsAnnotation.of([])],
      });
    }
  };

  constructor(private view: EditorView) {
    this._awareness.on("change", this._listener);
  }

  destroy() {
    this._awareness.off("change", this._listener);
  }

  update(update: ViewUpdate) {
    const ytext = this.conf.ytext;
    const ydoc = ytext.doc as Y.Doc;
    const awareness = this.conf.awareness;
    const fmEnd = update.state.field(fmEndField);
    const decorations: Range<Decoration>[] = [];
    const localState = awareness.getLocalState();

    // Update local cursor → awareness (offset by -fmEnd)
    if (localState != null) {
      const hasFocus =
        update.view.hasFocus &&
        update.view.dom.ownerDocument.hasFocus();
      const sel = hasFocus ? update.state.selection.main : null;
      const currentAnchor =
        localState.cursor == null
          ? null
          : Y.createRelativePositionFromJSON(localState.cursor.anchor);
      const currentHead =
        localState.cursor == null
          ? null
          : Y.createRelativePositionFromJSON(localState.cursor.head);

      if (sel != null) {
        const anchorInBody = Math.max(0, sel.anchor - fmEnd);
        const headInBody = Math.max(0, sel.head - fmEnd);
        const anchor = Y.createRelativePositionFromTypeIndex(
          ytext,
          anchorInBody
        );
        const head = Y.createRelativePositionFromTypeIndex(
          ytext,
          headInBody
        );
        if (
          localState.cursor == null ||
          !Y.compareRelativePositions(currentAnchor!, anchor) ||
          !Y.compareRelativePositions(currentHead!, head)
        ) {
          awareness.setLocalStateField("cursor", { anchor, head });
        }
      } else if (localState.cursor != null && hasFocus) {
        awareness.setLocalStateField("cursor", null);
      }
    }

    // Build decorations for remote cursors (offset by +fmEnd)
    const docLen = update.state.doc.length;
    awareness.getStates().forEach((state: any, clientid: number) => {
      if (clientid === awareness.doc.clientID) return;
      const cursor = state.cursor;
      if (cursor == null || cursor.anchor == null || cursor.head == null)
        return;

      const anchor = Y.createAbsolutePositionFromRelativePosition(
        cursor.anchor,
        ydoc
      );
      const head = Y.createAbsolutePositionFromRelativePosition(
        cursor.head,
        ydoc
      );
      if (
        anchor == null ||
        head == null ||
        anchor.type !== ytext ||
        head.type !== ytext
      )
        return;

      const rawColor = state.user?.color ?? "#30bced";
      const name = state.user?.name ?? "Anonymous";
      const color = /^#[0-9a-fA-F]{6,8}$/.test(rawColor) ? rawColor : "#30bced";
      const rawLight = state.user?.colorLight;
      const colorLight = (rawLight && /^#[0-9a-fA-F]{6,8}$/.test(rawLight)) ? rawLight : color + "33";

      // Offset ytext positions into editor positions
      const anchorPos = Math.min(anchor.index + fmEnd, docLen);
      const headPos = Math.min(head.index + fmEnd, docLen);
      const start = Math.min(anchorPos, headPos);
      const end = Math.max(anchorPos, headPos);

      if (start < end) {
        const startLine = update.view.state.doc.lineAt(start);
        const endLine = update.view.state.doc.lineAt(end);
        if (startLine.number === endLine.number) {
          decorations.push(
            Decoration.mark({
              attributes: { style: `background-color: ${colorLight}` },
              class: "cm-ySelection",
            }).range(start, end)
          );
        } else {
          const startEnd = startLine.from + startLine.length;
          if (start < startEnd) {
            decorations.push(
              Decoration.mark({
                attributes: { style: `background-color: ${colorLight}` },
                class: "cm-ySelection",
              }).range(start, startEnd)
            );
          }
          if (endLine.from < end) {
            decorations.push(
              Decoration.mark({
                attributes: { style: `background-color: ${colorLight}` },
                class: "cm-ySelection",
              }).range(endLine.from, end)
            );
          }
          for (let i = startLine.number + 1; i < endLine.number; i++) {
            const linePos = update.view.state.doc.line(i).from;
            decorations.push(
              Decoration.line({
                attributes: {
                  style: `background-color: ${colorLight}`,
                  class: "cm-yLineSelection",
                },
              }).range(linePos, linePos)
            );
          }
        }
      }

      decorations.push(
        Decoration.widget({
          side: headPos - anchorPos > 0 ? -1 : 1,
          block: false,
          widget: new YRemoteCaretWidget(color, name),
        }).range(headPos)
      );
    });

    this.decorations = Decoration.set(decorations, true);
  }
}

export const fmAwareRemoteSelections = ViewPlugin.fromClass(
  FmAwareRemoteSelectionsValue,
  { decorations: (v) => v.decorations }
);
