# Next Steps

## What's done

- **M1: Core CRDT sync** — Y.Text ↔ CM6 binding via Compartment, 3-case bootstrap (server state / local .yjs / seed from .md), debounced .md export, split-pane support.
- **M2: Embedded server** — plugin spawns y-websocket + LevelDB server as a child process via `ELECTRON_RUN_AS_NODE`. Room code registry (`adjective-noun-NN`) for session sharing. REST endpoints for room management.
- **M3: MCP sidecar** — 8 MCP tools (connect, read, replace, insert-after-heading, insert-after-pattern, append, disconnect, list-rooms). Claude Desktop connects, edits render in real-time with a labeled purple cursor using Yjs relative positions.
- **Multi-user collab** — ribbon icon toggles hosting, command palette for join. Tested with 3 concurrent peers (1 host + 2 joiners).
- **Debug logging** — toggleable via plugin settings, shared logger module.

## Polish Hitlist

### P0: Bugs / Correctness

- [ ] **collabActive flag set before server starts** — `startCollab()` should only set `collabActive = true` after `serverManager.start()` succeeds. Same issue in `showJoinModal()`.
- [ ] **Port-in-use handling** — if the port is already bound, the child process dies silently and we wait 5s for a health check timeout. Detect EADDRINUSE from child stderr and fail fast.
- [ ] **Restart race condition** — rapid stop→start could bind the same port before the old process exits. Add cooldown or wait for proc exit.
- [ ] **Flush pending writes on shutdown** — `stopCollab()` and `onunload()` should flush debounced `writeMarkdownFile()` calls before destroying sessions.
- [ ] **Persistence error handling** — `saveYjsState()` has no try/catch; `loadYjsState()` swallows real I/O failures.

### P1: Robustness

- [ ] **WebSocket disconnect handling** — `provider.on("status")` to surface disconnection in status bar + Notice. y-websocket reconnects automatically but the user should know.
- [ ] **Connection status in status bar** — show "Connecting...", "Disconnected (retrying)", etc. instead of just "Active".
- [ ] **Room code validation** — reject empty/whitespace `roomName` in POST /rooms/create.
- [ ] **Settings validation** — validate color as `#RRGGBB`, host as IP/hostname, port range 1024–65535.
- [ ] **Server crash recovery** — if child process exits unexpectedly, offer to restart via Notice.

### P2: UX Improvements

- [ ] **Remote cursor CSS** — add `styles.css` with proper `.cm-ySelectionCaret` / `.cm-ySelectionInfo` styling.
- [ ] **Collab indicator per file** — icon in file explorer or tab for files with active CRDT sessions.
- [ ] **"Who's here" panel** — list of connected users + colors from awareness state.
- [ ] **Join modal remembers last connection** — save recent `{ url, code }` pairs in settings.
- [ ] **Keyboard shortcut for toggle** — bind a hotkey to start/stop collab.
- [ ] **Notification when peer joins/leaves** — Notice on awareness changes.

### P3: Automated Testing

- [ ] **Unit tests: AgentDocumentSession** — replace, insertAfterPattern, insertAfterHeading, append. Pure Yjs, no network.
- [ ] **Unit tests: RoomCodeRegistry** — create, lookup, remove, duplicate create.
- [ ] **Unit tests: bootstrap ordering** — mock vault + Y.Doc, all 3 cases, verify `whenReady` resolves.
- [ ] **Integration test: two-client sync** — server + two WebsocketProviders, verify cross-client edits.
- [ ] **Integration test: MCP tools** — sidecar + server, call tools, verify edits appear in second client.
- [ ] **Test harness** — vitest, shared fixtures for Y.Doc and server lifecycle.

---

## Feature Roadmap

### F1: Presence & Identity

Each collaborator is visually distinct and identifiable.

- [ ] **Per-user cursor colors** — hash username to derive color, or host assigns from a palette on join.
- [ ] **Per-user selection highlights** — ensure each user sets `colorLight` matching their cursor color. Currently only sidecar sets it.
- [ ] **Username labels on cursors** — y-codemirror.next renders on hover via `.cm-ySelectionInfo`. Consider always-visible or fade-after-move.
- [ ] **"Who's here" sidebar** — panel or status bar popover listing users, colors, and current file. Built from awareness state.
- [ ] **User avatars** — stretch. Initials circle or gravatar next to cursor labels.

### F2: Networking & Access Control

Move beyond localhost to support remote collaboration with identity.

- [ ] **Relay server deployment** — Docker image or one-click deploy (Fly.io / Railway).
- [ ] **TLS support** — `wss://` via reverse proxy (Caddy/nginx) or native TLS.
- [ ] **Token-based auth** — server generates session token on host start. Embedded in room code or shared separately.
- [ ] **Email-based invitations** — generate invite links with server URL + room code + token.
- [ ] **Invite by username** — user registry, push notifications for pending invites.
- [ ] **Access levels** — read-only vs read-write, enforced server-side.
- [ ] **Persistent room metadata** — survive server restarts for long-lived sessions.

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

- [ ] **Host is canonical** — host's LevelDB is source of truth for recovery.
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

---

## Implementation Priority

**Near-term (next sessions):**
1. P0 bugs — correctness fixes for collab lifecycle
2. F1 presence basics — per-user colors, selection highlights, username visibility
3. P1 robustness — disconnect handling, status bar states
4. P2 UX — cursor CSS, who's here panel

**Medium-term:**
5. F3 Claude basics — invite command, thinking indicator, settle heuristic
6. F3 suggestion mode — highest-value Claude feature
7. P3 automated tests
8. F2 networking basics — TLS, token auth

**Longer-term:**
9. F2 email invitations, user registry
10. F4 conflict resolution, version snapshots
11. F5 block-level CRDT
12. F3 sidebar chat, streaming edits
