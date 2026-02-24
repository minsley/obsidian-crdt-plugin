# obsidian-crdt-coeditor — Project Plan

## What This Is

An Obsidian plugin that enables real-time collaborative editing of markdown notes using CRDTs (via Yjs), with a companion sidecar process that exposes a document editing interface to LLM agents (via MCP). The result is a human and an AI agent co-editing the same Obsidian note in real time, with presence/cursors visible to both sides.

This is novel — no existing plugin combines Yjs CRDT semantics with Obsidian and LLM co-editing. The closest prior art is Obsidian LiveSync, which uses CouchDB with last-write-wins (not true CRDT).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Obsidian Plugin                     │
│   CM6 EditorView                                     │
│   y-codemirror.next binding                          │
│   Y.Doc (one per open file)                          │
│   y-websocket client                                 │
└─────────────────┬───────────────────────────────────┘
                  │ WebSocket
┌─────────────────▼───────────────────────────────────┐
│            y-websocket Server (Node)                 │
│   y-leveldb persistence                              │
│   per-room Y.Doc state                               │
└─────────────────┬───────────────────────────────────┘
                  │ WebSocket
┌─────────────────▼───────────────────────────────────┐
│           Agent Sidecar (Node / MCP Server)          │
│   Y.Doc (same document, synced peer)                 │
│   AgentDocumentSession (high-level edit API)         │
│   MCP tool interface                                 │
└─────────────────┬───────────────────────────────────┘
                  │ MCP (stdio or SSE)
┌─────────────────▼───────────────────────────────────┐
│   Claude Desktop / any MCP-capable LLM client        │
└─────────────────────────────────────────────────────┘
```

**Room naming convention:** `obsidian/{vaultName}/{filePath}`  
This namespaces rooms per vault and file, so multiple vaults/files don't collide.

---

## Repository Structure

```
obsidian-crdt-coeditor/
├── plugin/                    # Obsidian plugin (TypeScript)
│   ├── src/
│   │   ├── main.ts            # Plugin entry point
│   │   ├── session.ts         # Per-file Y.Doc + provider lifecycle
│   │   ├── cm-extension.ts    # CM6 collab extension (registerEditorExtension)
│   │   ├── persistence.ts     # .yjs binary state file handling (file-based, no y-indexeddb)
│   │   ├── awareness.ts       # Cursor presence rendering
│   │   └── settings.ts        # Plugin settings (server URL, user name, color)
│   ├── manifest.json
│   └── package.json
│
├── server/                    # y-websocket relay + persistence (Node)
│   ├── src/
│   │   ├── index.ts           # WebSocketServer setup, y-leveldb persistence
│   │   └── config.ts
│   └── package.json
│
├── sidecar/                   # Agent sidecar / MCP server (Node)
│   ├── src/
│   │   ├── index.ts           # MCP server entry point
│   │   ├── document-session.ts # Y.Doc lifecycle, AgentDocumentSession class
│   │   ├── tools.ts           # MCP tool definitions
│   │   └── config.ts
│   └── package.json
│
└── README.md
```

---

## Component Specs

### 1. Obsidian Plugin (`plugin/`)

**Dependencies:**
- `yjs`
- `y-websocket` (client)
- `y-codemirror.next` (binding to CM6)

**Key behaviors:**

- On `file-open`: create a `CRDTSession` for the file if one doesn't exist
- On `file-close` / `leaf-change`: destroy the session and clean up
- Use `this.registerEditorExtension(collabExtension(this))` for CM6 integration — do not use the undocumented `StateEffect.appendConfig` approach; use a plugin-level store (Map keyed by filePath) that the extension reads from. **Implementation note:** since `registerEditorExtension` is shared across all editor instances, the CM6 extension must use a `ViewPlugin` or `EditorView.updateListener` that resolves the correct Y.Text by looking up the active file path from the view's state. Spike this pattern early in M1 — it's a high-risk integration point.
- Settings: WS server URL (default `ws://localhost:1234`), user display name, user color (hex)
- Persist Yjs binary state alongside the `.md` file as `.md_crdt/{filename}.yjs` within the vault (or in plugin data dir — make this configurable). **Note:** do not use `y-indexeddb` — file-based `.yjs` persistence is more appropriate for Obsidian since it keeps state in the vault and under version control.
- On update: debounce 1s, then serialize Y.Text → write to the `.md` file via `app.vault.modify()`. The `.md` file is a one-way export from the Yjs state, not the source of truth. **Important:** set a guard flag (e.g. `this._selfWrite = true`) before calling `app.vault.modify()` so that the `vault.on('modify')` handler can distinguish plugin-initiated writes from external writes and avoid re-processing its own output.
- **Bootstrap ordering** (must wait for `provider.on('synced')` before deciding which path to take):
  1. Server has Yjs state for this room → use server state (do nothing locally, sync handles it)
  2. Server has no state, local `.yjs` file exists → load from `.yjs` file and apply to Y.Doc
  3. Neither exists → seed Y.Text from `.md` file via `app.vault.read()`
  - This ordering prevents the race condition where the plugin seeds from `.md` while the server already has divergent Yjs state.

**Awareness (presence):**
- Set `{ user: { name, color }, cursor: { index } }` on local awareness state
- Render remote cursors as CM6 `Decoration.widget` overlays at the reported character index
- Use `provider.awareness.on('change', ...)` to update decorations

**Settings panel:** Standard Obsidian `PluginSettingTab` with fields for server URL, user name, color picker.

---

### 2. y-websocket Server (`server/`)

**Dependencies:**
- `ws`
- `y-websocket` (server utils)
- `y-leveldb`

**Behavior:**
- Single Node process, runs separately from Obsidian
- Listens on configurable port (default 1234)
- Uses `setupWSConnection` from `y-websocket/bin/utils`
- Persistence via `LeveldbPersistence` — stores full Yjs update history per room
- Room names passed as URL path: `ws://localhost:1234/{roomName}`
- No authentication in v1 — local use only. **Bind to `127.0.0.1` by default** (not `0.0.0.0`) to prevent other devices on the same network from connecting. Note in README that this should not be exposed to the internet without adding auth.

**Room registry:** The standard `y-websocket` server does not expose a room listing endpoint. Add an in-memory `Set<string>` of active room names (add on connection, remove when last client disconnects and after a grace period). Expose via a small HTTP endpoint (e.g. `GET /rooms`) on the same port, so the sidecar's `list_open_rooms` tool can query it.

**Config:** port, LevelDB path, and bind address (default `127.0.0.1`) via env vars or a `.env` file.

---

### 3. Agent Sidecar / MCP Server (`sidecar/`)

**Dependencies:**
- `yjs`
- `y-websocket` (client)
- `@anthropic-ai/sdk` or `@modelcontextprotocol/sdk` (MCP server)

**`AgentDocumentSession` class:**

```typescript
class AgentDocumentSession {
  constructor(private ytext: Y.Text, private awareness: Awareness) {}

  read(): string
  // Returns full current document content

  replace(search: string, replacement: string, occurrence?: number | 'all'): { success: boolean, position?: number, count?: number }
  // Finds occurrence of `search`, replaces with `replacement`
  // occurrence: 1-indexed match number, or 'all' to replace all. Defaults to 1 (first match).
  // Returns false if not found. When 'all', returns count of replacements made.

  insertAfterPattern(pattern: string, text: string): { success: boolean, error?: string }
  // Regex match on line level, inserts `text` after the matched line
  // Wraps regex construction in try/catch — malformed patterns from LLM agents return { success: false, error: 'Invalid regex: ...' }

  insertAtPosition(index: number, text: string): void
  // Raw index insert — use sparingly

  append(text: string): void
  // Append to end of document

  setPresence(cursor: number): void
  // Update awareness cursor position
}
```

**MCP tools to expose:**

| Tool | Description |
|------|-------------|
| `list_open_rooms` | Lists active rooms on the WS server (requires a room registry or HTTP endpoint on the server — see server notes) |
| `connect_to_note` | Connects to a room by vault + file path, returns session handle |
| `read_document` | Returns full document text for a connected session |
| `replace_text` | Find-and-replace in document (optional `occurrence: number \| 'all'` param, defaults to first match) |
| `insert_after_heading` | Insert text after a markdown heading (by heading text) |
| `insert_after_pattern` | Insert text after a regex-matched line |
| `append_to_document` | Append text at end |
| `disconnect` | Cleanly disconnect from a room |

**MCP transport:** stdio (for Claude Desktop). SSE support is a stretch goal.

**Sync handshake:** After connecting, wait for `provider.on('synced')` before allowing tool calls. The sidecar syncs with the **server** (which has LevelDB persistence), not with live peers — so it can connect and load document state even if no human has the note open. Timeout after 5s only if the server itself is unreachable.

**Presence:** On connect, set awareness to `{ user: { name: 'Claude Agent', color: '#8B5CF6' }, cursor: null }`. Update cursor after each edit tool call.

---

## Data Flow: Editing a Note

1. Human opens a note in Obsidian → plugin creates `CRDTSession`, connects to WS server
2. WS server restores Y.Doc state from LevelDB for that room
3. Plugin bootstraps Y.Text (from Yjs state if exists, else from `.md` file)
4. `y-codemirror.next` binding connects Y.Text ↔ CM6 EditorView — keystrokes now produce Yjs updates
5. Agent sidecar connects to same room via WS → receives full state sync
6. Claude Desktop calls `read_document` → agent reads Y.Text
7. Claude Desktop calls `replace_text` → agent calls `ytext.delete(idx, len); ytext.insert(idx, newText)`
8. Yjs update propagates → WS server → plugin → CM6 view updates in real time
9. Plugin debounce fires → `ytext.toString()` written to `.md` file

---

## Key Technical Constraints

**CM6 extension registration:** Use `this.registerEditorExtension()` in `onload`. Store per-file Y.Text references in a `Map<string, Y.Text>` on the plugin class. The CM6 extension reads from this map using the current file path as key. This avoids the undocumented `StateEffect.appendConfig` approach.

**Tombstoning / GC:** Yjs retains deleted characters (tombstones) until all peers have acknowledged the deletion. For long-lived documents, call `ydoc.gc = true` (default) and ensure all peers sync before closing. Do not implement custom GC in v1.

**External file modification:** If the user edits the `.md` file externally (git pull, another editor), the plugin detects this via `vault.on('modify')`. In v1, log a warning and do nothing — the Yjs state is authoritative. Document this limitation clearly.

**Undo:** Use `UndoManager` scoped to the local user's changes only. Wire up to standard Obsidian undo keybinding (Cmd/Ctrl+Z). UndoManager must be updated when new blocks are added (not applicable here since we use a single Y.Text per file, not block model).

**No block model in v1:** Use a single `Y.Text` for the whole file. Block model (splitting into `Y.Array<Y.Map>` with per-block `Y.Text`) is a future enhancement that enables structural conflict safety but adds significant complexity. For a notes/wiki use case with users working on different sections, whole-file Y.Text conflict risk is acceptable.

---

## Conflict with Other Sync Plugins

Document clearly in README: this plugin is **incompatible** with Obsidian Sync and iCloud sync for files actively being co-edited. Those systems write to `.md` files directly and will produce conflicts with the Yjs-managed exports. Recommended approach: use git for version history instead of sync, and treat the `.md` file as the git-committed artifact.

---

## Build & Dev Setup

- Plugin: `esbuild` (standard for Obsidian plugins), output to `plugin/dist/main.js`
- Server + sidecar: `tsc` or `tsx` for dev, `esbuild` for prod bundle
- Use `pnpm workspaces` at repo root to manage the three packages. **Important:** configure `.npmrc` with `shamefully-hoist=false` and ensure `yjs` is not duplicated across packages. Duplicate Yjs instances are a common footgun — Y.Doc instances from different copies of `yjs` cannot sync. Pin a single version in the workspace root and use `pnpm.overrides` if needed.
- Local dev: symlink `plugin/dist/` into `.obsidian/plugins/obsidian-crdt-coeditor/` in a test vault

---

## Implementation Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CM6 `registerEditorExtension` shared across editors — wrong Y.Text binding | Edits routed to wrong document | Spike the `ViewPlugin` lookup pattern in M1 before building anything else |
| Bootstrap race: plugin seeds from `.md` while server has existing Yjs state | Document content duplicated or corrupted | Wait for `provider.on('synced')` and check remote state before seeding (see bootstrap ordering above) |
| `vault.on('modify')` fires on plugin's own `.md` writes | Infinite loop or spurious "external edit" warnings | Guard flag (`_selfWrite`) around `app.vault.modify()` calls |
| Duplicate `yjs` instances across pnpm packages | Y.Doc objects silently fail to sync | Pin single `yjs` version in workspace root, use `pnpm.overrides` |
| LLM agent sends malformed regex to `insertAfterPattern` | Uncaught exception crashes sidecar | try/catch around `new RegExp()`, return structured error |
| Server bound to `0.0.0.0` on shared network | Unauthorized connections | Default bind to `127.0.0.1` |

---

## Milestones

### M1 — Single-user local sync
- **Spike first:** CM6 `ViewPlugin` pattern for per-file Y.Text lookup via `registerEditorExtension`
- Plugin connects to WS server
- Y.Text bound to CM6 via y-codemirror.next
- Changes persist to LevelDB on server
- `.md` file updated on debounce (with self-write guard)
- Bootstrap from existing `.md` file on first connect (with correct ordering per bootstrap rules above)

### M2 — Multi-user human co-editing
- Awareness / cursor presence rendering in CM6
- Settings panel (server URL, display name, color)
- Stable session lifecycle (open/close/switch files)

### M3 — Agent sidecar + MCP
- `AgentDocumentSession` with all edit primitives
- MCP server with full tool set
- Server HTTP endpoint for room listing (`GET /rooms`)
- Claude Desktop can read and edit a note in real time
- Agent presence visible in Obsidian

### M4 — Polish
- Graceful handling of server disconnect / reconnect
- Conflict warning when external `.md` modification detected
- README with setup guide, architecture diagram, known limitations
- Consider block model for structural conflict safety

---

## Prior Art / References

- [Yjs docs](https://docs.yjs.dev)
- [y-codemirror.next](https://github.com/yjs/y-codemirror.next)
- [y-websocket](https://github.com/yjs/y-websocket)
- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
- [Obsidian LiveSync](https://github.com/vrtmrz/obsidian-livesync) — prior art, different approach (CouchDB, LWW)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [y-codemirror.next example](https://github.com/yjs/y-codemirror.next/tree/main/demo)

---

## What to Ask Claude Code to Start With

> "Bootstrap the monorepo structure for `obsidian-crdt-coeditor` per the project plan. Start with M1: get the Obsidian plugin connecting to a local y-websocket server, binding Y.Text to the CM6 editor, and writing changes back to the `.md` file. Use pnpm workspaces. TypeScript throughout. Also create a `test-vault/` directory at the repo root configured as a minimal Obsidian vault with dummy content for manual testing."

### Test Vault Setup (`test-vault/`)

Create a minimal Obsidian vault at the repo root for development and testing:

```
test-vault/
├── .obsidian/
│   ├── app.json              # Minimal Obsidian app config
│   ├── appearance.json       # {}
│   └── plugins/
│       └── obsidian-crdt-coeditor/  # Symlink target for plugin build output
├── Welcome.md                # Short intro note (~5 lines)
├── Meeting Notes/
│   ├── 2025-01-15 Kickoff.md       # Typical meeting note with headings, bullets, action items
│   └── 2025-02-01 Sprint Review.md # Another meeting note, different structure
├── Projects/
│   ├── Project Alpha.md      # Longer note (~50 lines) with multiple headings, code blocks, links
│   └── Project Beta.md       # Shorter note (~15 lines)
└── Scratch.md                # Empty file (tests bootstrap from empty .md)
```

Requirements for the dummy content:
- Notes should use realistic markdown: headings, bullet lists, code fences, internal `[[links]]`, tags
- Include at least one note >30 lines to test scrolling/large-doc behavior
- Include one empty file to test the "seed from empty `.md`" bootstrap path
- `test-vault/.obsidian/plugins/obsidian-crdt-coeditor/` should be the symlink target referenced in the dev setup instructions
- Add `test-vault/` to `.gitignore` patterns for LevelDB data and `.yjs` state files (but commit the vault structure and dummy notes themselves):
  ```
  test-vault/.obsidian/plugins/obsidian-crdt-coeditor/main.js
  test-vault/.obsidian/plugins/obsidian-crdt-coeditor/styles.css
  test-vault/**/*.yjs
  test-vault/.md_crdt/
  ```
