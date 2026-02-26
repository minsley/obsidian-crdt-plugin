# Next Steps

## What's done

- **M1: Core CRDT sync** — Y.Text ↔ CM6 binding via Compartment, 3-case bootstrap (Yjs state / seed from .md / diff-apply mismatch), debounced .md export, split-pane support.
- **M2: Relay server** — y-websocket + LevelDB server (`server/src/index.ts`). Room code registry. REST endpoints. Currently used by MCP sidecar; plugin uses WebRTC instead.
- **M3: MCP sidecar** — 8 MCP tools (connect, read, replace, insert-after-heading, insert-after-pattern, append, disconnect, list-rooms). Connects via y-websocket to relay server. Claude Desktop edits render in real-time with labeled cursor.
- **M4: WebRTC peer-to-peer** — y-webrtc for plugin↔plugin sync. Self-hosted signaling server (`server/src/signaling.ts`). Room codes as WebRTC room names. No relay needed for human↔human collaboration.
- **M5: Collaborative File Model** — UUID frontmatter identity (`collab-id`), UUID-keyed Yjs persistence (Obsidian Sync compatible), per-file `CollabState` machine, Host/Join modal with awareness-based UUID discovery, editor header buttons, file-menu entries, auto-generated adjective-animal names + hue-wheel colors.
- **UI polish (3a–3e)** — Modal flex layout with responsive breakpoints. State iconography (spin/green/muted). Status bar with colored dot + name + peer count. Stable cursor via Y.RelativePosition across remote edits. Deferred CM6 attach for first-time joiners (5s timeout).
- **PR #1 review hardening** — Path traversal prevention (UUID validation + filename sanitization), rename handler for map migration, null guards in FM sync, connecting→live state ordering, bootstrap error propagation, signaling server input validation, CSS injection prevention, Uint8Array buffer slicing, FM perf optimization, single-dispatch cursor restoration, content-based self-write detection.

---

## Current Architecture

### Transport modes

| Path | Transport | When |
|------|-----------|------|
| Plugin ↔ Plugin | WebRTC (y-webrtc) | Human↔human collaboration |
| Plugin ↔ Agent | y-websocket (relay) | MCP sidecar / Claude integration |
| Signaling | WebSocket (server/src/signaling.ts) | WebRTC peer discovery |

### Data model

- **Frontmatter**: `collab-id: <uuid>` — file identity, travels with file on rename/move/sync
- **Yjs state**: `.obsidian/plugins/obsidian-crdt-coeditor/yjs/<uuid>` — UUID-keyed, synced by Obsidian Sync
- **Plugin settings**: signaling URL, user identity (name + color)
- **Room codes**: ephemeral `adjective-noun-NN`, generated fresh each hosting session

### Session lifecycle

```
Offline → Connecting → Live (0 peers) ↔ Live (N peers) → Disconnecting → Offline
```

State transitions are guarded: `"connecting"` set immediately, `"live"` only after `whenReady` resolves. Failed bootstrap resets to `"offline"`.

### Bootstrap / join logic

On session start, compare Yjs-rendered content to current `.md`:
- Match → use Yjs state (incremental reconnect, shared history intact)
- Mismatch → diff-apply offline edits as Yjs operations via `fast-diff`
- Empty Yjs → seed from .md body (or wait for peers if body also empty)

Bootstrap strips any legacy FM remnants from ytext before diffing.

On joining with a room code:
1. Host sets `{ uuid, filename }` in awareness state field
2. Joiner's `discoverUuid()` polls awareness for `docMeta` (10s timeout)
3. Joiner searches vault frontmatter for matching `collab-id`
   - **Found**: open file, bootstrap as above
   - **Not found**: create new file with UUID, receive host state

Peer-provided UUID is validated (`/^[0-9a-f-]{36}$/i`). Filenames are sanitized (strip `../`, `/`, `\`).

### FM-aware sync pipeline

Frontmatter never enters ytext. Custom CM6 plugins replace `yCollab()`:

- **`fmEndField`** (StateField) — tracks FM end offset. Uses `sliceString(0, 2000)` and `touchesRange` guard for perf.
- **`fmAwareYSync`** (ViewPlugin) — offsets all positions by fmEnd. Single dispatch for content + cursor restoration.
- **`fmAwareRemoteSelections`** (ViewPlugin) — offsets cursor positions by ±fmEnd. Validates peer color values.

### Key files

| File | Purpose |
|------|---------|
| `plugin/src/main.ts` | Plugin lifecycle, collabFiles map, header buttons, status bar, rename handler |
| `plugin/src/webrtc-session.ts` | WebRTCSession: bootstrap→startProvider ordering, content-based self-write detection |
| `plugin/src/fm-offset.ts` | `fmEndField`, `frontmatterEndIndex()`, `stripFrontmatter()`, `extractFrontmatter()` |
| `plugin/src/fm-y-sync.ts` | FM-aware ySync ViewPlugin (editor↔ytext with offset) |
| `plugin/src/fm-remote-selections.ts` | FM-aware remote cursors/selections + color validation |
| `plugin/src/cm-extension.ts` | Wires FM sync + undo manager via Compartment |
| `plugin/src/diff-apply.ts` | `applyDiffToYText()` via `fast-diff` |
| `plugin/src/persistence.ts` | UUID-validated Yjs binary read/write with proper buffer slicing |
| `plugin/src/frontmatter.ts` | UUID CRUD via `processFrontMatter` |
| `plugin/src/identity.ts` | `generateName()`, `colorForPeerIndex()` |
| `plugin/src/collab-state.ts` | `CollabState` type + `FileCollabInfo` interface |
| `plugin/src/online-modal.ts` | Two-panel Host/Join modal |
| `plugin/src/unlink-modal.ts` | Warning modal with "don't show again" |
| `plugin/src/settings.ts` | Plugin settings + identity UI |
| `plugin/esbuild.config.mjs` | Yjs dedup plugin + y-codemirror.next subpath resolver |
| `server/src/signaling.ts` | WebRTC signaling with input validation |
| `sidecar/src/` | MCP sidecar (y-websocket, 8 tools) |

---

## Next: Session Continuity & Infrastructure

### 6 — Session continuity

These are the highest-priority UX gaps. Currently, sharing a room requires manually entering a room code, and hosts can't re-access their code after closing the modal.

**6a. Host room code access** (quick win)
- Show active room code in status bar when hosting (click to copy)
- Add room code to header button tooltip for hosts
- Scope: `main.ts` — extend `updateStatusBar()` and `stateTooltip()`

**6b. Copy Room Code command** (already exists)
- `copy-room-code` command works but is only discoverable via Cmd+P or context menu
- Consider: auto-copy to clipboard on host start, with notice showing the code

**6c. Rejoining without room code** (design decision needed)
- Problem: returning user with existing collab file must get a fresh room code from the host every time
- Options to evaluate:
  - **(a) Deterministic room from UUID** — derive room code from UUID hash so both peers compute the same room. Simple, but means anyone who knows the UUID can join (acceptable for trusted-network use?). Also means room code never changes — no session isolation.
  - **(b) Awareness scan** — "Find active session" mode that creates a temp provider, scans all rooms on the signaling server for matching UUID in awareness. Slow, doesn't scale, exposes room enumeration.
  - **(c) Last-known room code** — persist the last room code per UUID in plugin settings. On "Go Online", offer "Rejoin last room?" before showing the modal. Simple, but stale if host has started a new session.
  - **(d) UUID-based signaling channel** — host publishes room code to a well-known signaling topic derived from UUID. Joiner subscribes to that topic to discover the current room code. Lightweight, no scanning needed.
- **Recommendation**: Option (d) is cleanest — it uses existing signaling infrastructure, supports multiple sessions over time, and doesn't require room enumeration. Worth discussing.

### 7 — Infrastructure

**7a. Signaling server deployment**
- Currently `ws://localhost:4444`. Need a public instance for real use.
- Options: DigitalOcean droplet, Fly.io, or Render.
- Minimal resource needs — signaling is just relay, no state.

**7b. TURN relay for NAT traversal**
- ~15–20% of connections fail without TURN (symmetric NAT, corporate networks).
- Free tiers: Open Relay, Metered.ca. Paid: Twilio, Xirsys.
- Not urgent until user-reported failures, but should be configurable in settings.

**7c. Obsidian Sync 5MB file limit**
- Yjs state is typically 2–20 KB for text notes.
- Add a soft warning if Yjs state approaches 1 MB.
- Not urgent for current scope.

---

## Feature Roadmap (longer-term)

### F3: Claude Integration

Make Claude a first-class collaborator. Depends on MCP sidecar (M3), which currently connects via y-websocket relay.

**Open question**: Should the sidecar migrate to WebRTC to match plugin↔plugin transport? Or keep y-websocket relay as the agent transport layer?
- Pro WebRTC: single transport, no relay server needed
- Pro y-websocket: sidecar runs headless (no browser WebRTC), simpler reconnection
- **Likely answer**: Keep y-websocket for agents. It's proven, headless-friendly, and the relay server is needed for signaling anyway.

**Inviting Claude:**
- [ ] "Invite Claude" command — trigger sidecar to connect to the current room
- [ ] Auto-connect sidecar on collab start — settings toggle

**Commanding Claude:**
- [ ] Inline commands — `/claude <instruction>` detected via Y.Text observer
- [ ] Command palette — "Ask Claude to..." with document context
- [ ] Sidebar chat — Y.Array-backed conversation panel

**Claude's workflow:**
- [ ] Settle heuristic — debounce after last edit (configurable, default 3s)
- [ ] Thinking indicator — awareness `{ thinking: true }` → animated indicator
- [ ] Streaming edits — throttled Y.Text insertions for typing effect

**Suggested edits & approval:**
- [ ] Suggestion mode — Y.Map("suggestions") with id, range, proposed text, rationale
- [ ] CM6 decorations — inline diffs with accept/reject buttons
- [ ] Batch accept/reject

### F4: Conflict Resolution & History

- [ ] Conflict markers — highlight + Notice when concurrent edits merge in same region
- [ ] Edit attribution — Yjs client IDs → usernames via awareness
- [ ] Version snapshots — periodic Y.Doc snapshots, named entries, rollback

### F5: Block-Level CRDT

Move from single Y.Text to structured document model. Major undertaking — evaluate after F3.

- [ ] Block model — `Y.Array<Y.Map>` per block
- [ ] Markdown ↔ block parser
- [ ] CM6 per-block binding
- [ ] Migration from single-Y.Text

---

## Build

```bash
cd plugin && npm run build    # plugin → plugin/dist/main.js
cd server && npm run build    # signaling + relay → server/dist/
```

Test vault symlinks `plugin/dist/main.js` into `.obsidian/plugins/`.
