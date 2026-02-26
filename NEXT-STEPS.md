# Next Steps

## What's done

- **M1: Core CRDT sync** — Y.Text ↔ CM6 binding via Compartment, 3-case bootstrap (server state / local .yjs / seed from .md), debounced .md export, split-pane support.
- **M2: Embedded server** — plugin spawns y-websocket + LevelDB server as a child process via `ELECTRON_RUN_AS_NODE`. Room code registry (`adjective-noun-NN`) for session sharing. REST endpoints for room management.
- **M3: MCP sidecar** — 8 MCP tools (connect, read, replace, insert-after-heading, insert-after-pattern, append, disconnect, list-rooms). Claude Desktop connects, edits render in real-time with a labeled purple cursor using Yjs relative positions.
- **Multi-user collab** — ribbon icon toggles hosting, command palette for join. Tested with 3 concurrent peers (1 host + 2 joiners).
- **Debug logging** — toggleable via plugin settings, shared logger module.
- **M4: WebRTC prototype** — y-webrtc peer-to-peer sync, self-hosted signaling server (`server/src/signaling.ts`), room codes as WebRTC room names, no embedded relay server needed.
- **M5: Collaborative File Model** — UUID frontmatter identity (`collab-id`), UUID-keyed Yjs persistence in plugin folder (Obsidian Sync compatible), per-file `CollabState` machine, Host/Join modal with awareness-based UUID discovery, editor header buttons, file-menu entries, auto-generated adjective-animal names + hue-wheel colors.

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

- [x] **UUID frontmatter read/write** — `getCollabId`, `setCollabId`, `removeCollabId`, `findFileByCollabId` in `frontmatter.ts`.
- [x] **Yjs storage migration** — UUID-keyed binary files in `.obsidian/plugins/obsidian-crdt-coeditor/yjs/{uuid}`. `persistence.ts` updated; old `.md_crdt` sidecar approach removed.
- [x] **docMeta in awareness** — host sets `{ uuid, filename }` in awareness so joiners discover UUID via WebRTC awareness API.
- [x] **Join flow: UUID lookup** — `discoverUuid(roomCode)` waits for awareness docMeta; `findFileByCollabId` searches vault; creates new file if not found.
- [x] **Session state machine** — `CollabState` type + `FileCollabInfo` in `collab-state.ts`; `collabFiles: Map<string, FileCollabInfo>` replaces `collabActive` + `sessions`.
- [ ] **Bootstrap: diff-apply for offline edits** — if `.yjs` content ≠ `.md`, apply diff as Yjs text operations. Deferred: requires `fast-diff` and Yjs transaction work.

### N1: UI

- [x] **Editor header button** — `view.addAction()` per MarkdownView, stored in `WeakMap`. Icon + tooltip reflect file state; updates on state change.
- [x] **Online modal** — `online-modal.ts`: two-panel Host/Join, transitions in-place on host click.
- [x] **File explorer context menu** — `file-menu` event: "Make Collaborative" / "Go Online" / "Go Offline" / "Copy Room Code" / "Unlink".
- [x] **Commands** — `make-collaborative`, `go-online`, `go-offline`, `copy-room-code`, `unlink-collaboration` via `editorCallback`.
- [ ] **Unlink warning modal** — with "don't show again" checkbox, in-session Restore option. Deferred.
- [ ] **Unlink undo cache** — hold UUID + Yjs in memory until editor closes; offer Restore. Deferred.

### N2: Identity

- [x] **Auto-generated names** — `generateName()` in `identity.ts` (adjective + animal).
- [x] **Auto-generated colors** — `colorForPeerIndex()` with binary hue-wheel (0°, 180°, 90°, 270°, …).
- [x] **Auto-generate on first session** — `ensureSettingsIdentity()` in main.ts assigns name + color before first `beginHosting` / `joinSession`.
- [x] **Dice-roll in settings** — "Roll" button regenerates name + color, re-renders settings tab.
- [x] **Color picker in settings** — native `addColorPicker`, identity preview swatch.

### Known issues / session notes (2026-02-25)

**Frontmatter / yCollab interaction (partially fixed, needs monitoring)**

In Obsidian Live Preview, the CM6 editor document includes the YAML
frontmatter block as raw text. yCollab binds to the full editor, so
when the editor includes FM, yCollab syncs it into ytext. We strip FM
from ytext before every file write and read FM fresh from disk instead.
A no-op guard skips writes when content hasn't changed, breaking the
duplication loop.

Remaining risk: ytext may accumulate FM internally (Yjs state on disk
will include it). This is invisible to users but could cause issues
when peers with different UUIDs exchange Yjs state — their FMs would
CRDT-merge in unpredictable ways. Proper fix: scope yCollab to the
body range of the editor only, not the full document. Deferred.

### Deferred (document for next sprint)

- **Scope yCollab to editor body only** — yCollab currently binds to the full CM6 editor doc which includes YAML frontmatter in Obsidian Live Preview. Need to offset yCollab's range by the FM length, or use a CM6 facet to exclude the FM region from the binding. This is the clean fix for the FM/ytext contamination.
- **Diff-apply for offline edits** — requires `fast-diff` dep + Yjs transact. Most complex bootstrap case.
- **Unlink warning modal** — "don't show again" with `unlinkWarningDismissed` settings field (field added, modal not yet built).
- **Unlink undo cache / Restore** — hold `unlinkCache: { yjsData }` in `FileCollabInfo` until plugin unload.
- **Returning joiner UUID match** — when going online on a file that already has a matching UUID, skip the awareness discovery step and go straight to session creation.

---

## Next Design Session

### 3 — UI polish
- **3a. Modal layouts** — Host/Join panels feel cramped; needs proper spacing, hierarchy, and mobile-friendly layout.
- **3b. State iconography** — offline/connecting/live/disconnecting icons need a coherent visual language. Current: users/radio-tower/wifi/loader. Revisit with a designer eye.
- **3c. Local user cursor color** — collaborators see each other's colored cursors, but the local user has no visual indicator of their own color/name as others see it. Add a local cursor decoration or status bar badge showing "you are Amber Otter (●)".
- **3d. Stable local cursor on remote edits** — when a remote peer types above your cursor, your cursor gets pushed/pulled. Use Yjs relative positions to map the local selection through remote changes, preserving the user's logical position in the document.

### 4 — Block-based CRDT
Move from single Y.Text to Y.Array of blocks for better conflict reconciliation on paragraph-level edits. See F5 in Feature Roadmap.

### 5 — Session continuity
- **Rejoining without room code** — when a user opens an existing collab file and goes online, skip the awareness-discovery step (they already have the UUID). Just need to know a room code to join. Options: (a) host always shows their active room code somewhere accessible, (b) room code derived deterministically from UUID, (c) a "look for active session" mode that scans awareness.
- **Host room code access** — once hosting, give the host an easy way to re-copy the room code without reopening the modal (e.g., header button tooltip, or a persistent status bar element showing the active code).

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
