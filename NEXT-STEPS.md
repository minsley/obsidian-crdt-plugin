# Next Steps

## What's done

- **M1: Core CRDT sync** — Y.Text ↔ CM6 binding via Compartment, 3-case bootstrap (server state / local .yjs / seed from .md), debounced .md export, split-pane support.
- **M2: Embedded server** — plugin spawns y-websocket + LevelDB server as a child process via `ELECTRON_RUN_AS_NODE`. Room code registry (`adjective-noun-NN`) for session sharing. REST endpoints for room management.
- **M3: MCP sidecar** — 8 MCP tools (connect, read, replace, insert-after-heading, insert-after-pattern, append, disconnect, list-rooms). Claude Desktop connects, edits render in real-time with a labeled purple cursor using Yjs relative positions.
- **Multi-user collab** — ribbon icon toggles hosting, command palette for join. Tested with 3 concurrent peers (1 host + 2 joiners).
- **Debug logging** — toggleable via plugin settings, shared logger module.
- **M4: WebRTC prototype** — y-webrtc peer-to-peer sync, self-hosted signaling server (`server/src/signaling.ts`), room codes as WebRTC room names, no embedded relay server needed.

---

## Architecture: Collaborative File Model (next major milestone)

This section captures the agreed design for the next major rework. Current WebRTC prototype is a stepping stone; this is the target architecture.

### Mental model

There are two distinct layers:

**1. File type: Normal vs Collaborative**
A Collaborative file is a different kind of file from the user's perspective. It has a `collab-id` UUID in its frontmatter. This UUID is the stable identity of the document across all peers, devices, and renames. The file remains Collaborative indefinitely — it does not revert to Normal when a session ends.

**2. Session state: Offline / Online toggle (Collaborative files only)**
The Online/Offline toggle lives in the editor UI for Collaborative files. It has transient states:

```
Offline → Connecting → Live (0 peers) ↔ Live (N peers) → Disconnecting → Offline
```

- **Offline**: has UUID, Yjs state saved, no network activity
- **Connecting**: WebRTC handshake in progress (system-driven transient)
- **Live (0 peers)**: session open, no peers yet — user-actionable, can wait or go offline
- **Live (N peers)**: active collaboration
- **Disconnecting**: flushing writes, saving Yjs state, closing WebRTC (system-driven transient)

### Data model

- **Frontmatter**: `collab-id: <uuid>` — file identity, travels with the file on rename/move/sync
- **Yjs state**: `.obsidian/plugins/obsidian-crdt-coeditor/yjs/<uuid>` — keyed by UUID, not file path; synced by Obsidian Sync automatically
- **Plugin settings**: signaling URL, user identity (name + color)
- **Room codes**: ephemeral, generated fresh each hosting session, not persisted

### Bootstrap / join logic

On session start, always compare `.yjs`-rendered content to current `.md`:
- Match → use `.yjs` (incremental reconnect, shared history intact)
- Mismatch → `.md` was edited outside a session → diff-apply changes to Yjs as new operations on top of shared history

On joining with a room code:
1. Host sends `{ type: 'doc-meta', uuid, filename }` as first WebRTC message before Yjs sync
2. Joiner searches vault frontmatter for matching `collab-id`
   - **Found + Yjs state exists**: open file, diff-apply any offline edits, sync
   - **Found + no Yjs state**: alert user ("shared history not found — starting fresh copy from host"), receive host state
   - **Not found**: create new file with UUID in frontmatter, receive host state

### Peer symmetry

No permanent host/joiner distinction. Any peer with a Collaborative copy of a file can host a new session or join one. The CRDT reconciles regardless.

### Host/Join UI (single modal, Option 1)

Going Online presents one modal with two sections:
- **Host button** (left): starts session, modal transitions in-place to show room code + copy button. Room code remains visible until user explicitly closes the modal or clicks outside to dismiss. Does not auto-close on peer connect — user may want to share code with multiple people.
- **Join input** (right): enter room code, submit → spinner replaces button → modal closes on successful sync.

### Unlink (working name)

Removes `collab-id` from frontmatter, deletes Yjs state from plugin folder. Shows a warning modal with "don't show again" checkbox (stored in settings). Until the editor is closed, the UUID + Yjs are held in memory and a "Restore Collab" option is offered. After close, unrecoverable (user's own backup tools apply).

### UI surfaces

- **Editor pane header button** — `view.addAction()` on MarkdownView. Icon reflects file state. Primary interaction surface.
- **Right-click in file explorer** — `workspace.on('file-menu')`. "Make Collaborative" on Normal files; "Copy Room Code", "Go Online", "Unlink" on Collaborative files.
- **Editor context menu** — `workspace.on('editor-menu')`. Same as above for the body of the editor.
- **Commands (Cmd+P)** — use `editorCallback` (scoped to focused file). "Make Collaborative", "Go Online / Go Offline", "Copy Room Code", "Unlink".

---

## Implementation Tasks (next milestone)

### N0: Core architecture

- [ ] **UUID frontmatter read/write** — `getCollabId(file)`, `setCollabId(file, uuid)`, `removeCollabId(file)`. Parse/write YAML frontmatter without stomping other fields.
- [ ] **Yjs storage migration** — move from `{filePath}.yjs` sidecars to `.obsidian/plugins/.../yjs/{uuid}`. Update `persistence.ts`.
- [ ] **doc-meta protocol message** — host sends `{ type: 'doc-meta', uuid, filename }` before Yjs sync. Joiner waits for this before deciding which file to open.
- [ ] **Bootstrap: diff-apply for offline edits** — if `.yjs` content ≠ `.md`, compute diff (Myers / patience), apply as Yjs text operations on top of existing history.
- [ ] **Join flow: UUID lookup** — search vault for file with matching `collab-id`, handle found/not-found/no-yjs cases.
- [ ] **Session state machine** — `CollabState` enum (`normal` | `offline` | `connecting` | `live` | `disconnecting`), per-file state tracked in plugin.

### N1: UI

- [ ] **Editor header button** — shows state icon, opens Online modal or toggles offline. Use `view.addAction()` on all MarkdownViews; update icon on state change.
- [ ] **Online modal** — Host button + Join input in one modal. Host path: start session, transition modal to show room code. Join path: submit code → spinner → close.
- [ ] **File explorer context menu** — "Make Collaborative" / "Unlink" / "Copy Room Code" via `file-menu` event.
- [ ] **Unlink warning modal** — with "don't show again" checkbox, in-session Restore option.
- [ ] **State-aware status bar** — replace current text with state + peer count for Collaborative files.

### N2: Identity

- [ ] **Auto-generated names** — `generateName()` function combining adjective + animal lists. Used to produce the ~200 curated pairs baked into the source, and exposed for the dice-roll in settings. Assigned on first session if name not set in settings.
- [ ] **Auto-generated colors** — binary space-filling around hue wheel: user 0 = 0° (red), 1 = 180° (cyan), 2 = 90°, 3 = 270°, etc. Covers 2–8 users with distinct, legible colors. Assigned by join order via awareness. Stored in settings.
- [ ] **Dice-roll in settings** — button calls `generateName()` and picks the next unused hue slot, previews both. User can keep rolling until satisfied.
- [ ] **Color + name stored in settings** — persist across sessions; don't reassign if already set.

---

## Known Concerns / Investigate Later

- [ ] **Obsidian Sync 5MB file limit** — Yjs state for text notes is small (typically 2–20 KB), but could become relevant for long-lived sessions with large edit histories, binary attachments, or future whole-vault collaboration. Investigate limits and add a soft warning if Yjs state approaches 1MB.
- [ ] **Signaling server public deployment** — currently defaults to `ws://localhost:4444` for local dev. Once a hosted instance exists, update `DEFAULT_SETTINGS.signalingUrl`. Track deployment in a separate infra doc.
- [ ] **WebRTC TURN server** — ~15–20% of connections (symmetric NAT, corporate networks) will fail without a TURN relay. Free tiers exist (Open Relay, Metered.ca). Evaluate when NAT failures become user-reported.

---

## Feature Roadmap (unchanged / longer-term)

### F3: Claude Integration

Make Claude a first-class collaborator.

**Inviting Claude:**
- [ ] **"Invite Claude" command** — trigger sidecar to connect to the current room from within Obsidian.
- [ ] **Auto-connect sidecar on collab start** — settings toggle to launch sidecar automatically.

**Commanding Claude:**
- [ ] **Inline commands** — `/claude <instruction>` syntax detected via CM6 decoration or Y.Text observer, forwarded to sidecar.
- [ ] **Command palette integration** — "Ask Claude to..." prompts with document context.
- [ ] **Sidebar chat** — panel for chatting with Claude about the document, backed by a Y.Array for shared conversation.

**Claude's workflow:**
- [ ] **Settle heuristic** — debounce after last edit before processing commands (configurable, default 3s).
- [ ] **Thinking indicator** — awareness state `{ thinking: true }` renders as animated indicator near Claude's cursor.
- [ ] **Streaming edits** — throttled Y.Text insertions for a natural typing effect.

**Suggested edits & approval:**
- [ ] **Suggestion mode** — Claude writes to a `Y.Map("suggestions")` instead of main Y.Text. Each entry: id, range (relative positions), proposed text, rationale, status.
- [ ] **Render suggestions as decorations** — CM6 inline diffs (strikethrough deletions, highlighted insertions) with accept/reject buttons.
- [ ] **Accept/reject commands** — accept applies to Y.Text, reject removes. Batch accept/reject all.
- [ ] **Suggestion notifications** — Notice when Claude adds suggestions, click to scroll.

### F4: Canonical Document & Conflict Resolution

- [ ] **Conflict markers** — brief highlight + Notice when concurrent edits merge in the same region.
- [ ] **Edit attribution** — map Yjs client IDs → usernames via awareness, render as subtle per-line background.
- [ ] **Version snapshots** — periodic Y.Doc snapshots, named entries in a Y.Array, rollback support.

### F5: Block-Level CRDT

Move from single Y.Text to structured document model.

- [ ] **Block model** — `Y.Array<Y.Map>` where each block has `{ type, text: Y.Text, attrs: Y.Map }`.
- [ ] **Markdown ↔ block parser** — bidirectional, handles code blocks, nested lists, frontmatter.
- [ ] **CM6 block binding** — per-block yCollab binding instead of whole-document.
- [ ] **Structural conflict safety** — paragraph reordering doesn't corrupt text within blocks.
- [ ] **Migration** — backwards compatible with existing single-Y.Text documents.
