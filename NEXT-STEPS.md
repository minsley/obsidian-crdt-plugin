# Next Steps

Current state: M1 code is written and builds. No manual testing has been done yet.

## Immediate: M1 validation

These should be done before writing any more code.

### 1. Manual smoke test

Start the server, open the test vault in Obsidian, enable the plugin, and open a note. Verify:

- [ ] Plugin connects to `ws://localhost:1234` without errors (check Obsidian dev console)
- [ ] Typing produces Yjs updates (server should log connections)
- [ ] The `.md` file updates after the 1s debounce
- [ ] A `.md_crdt/` directory is created with `.yjs` state files
- [ ] Closing and reopening a note loads from Yjs state (not re-seeding from `.md`)
- [ ] Opening `Scratch.md` (empty file) doesn't throw

### 2. CM6 Compartment binding

The rewritten `cm-extension.ts` uses a Compartment with a watcher ViewPlugin. This is the highest-risk piece. During the smoke test, verify:

- [ ] The yCollab binding attaches when a note is opened (cursor blinking, typing works)
- [ ] Switching between notes detaches the old binding and attaches the new one
- [ ] Opening two notes in split panes binds each to the correct Y.Text
- [ ] No "Y.Text already bound" errors in console

If the `resolveFilePath()` approach (iterating markdown leaves and comparing `cm` references) doesn't work reliably in Obsidian's internal structure, fallback options:

- Use `EditorView.state.field()` to stash the file path as a custom StateField
- Hook into Obsidian's `MarkdownView` lifecycle more directly

### 3. Bootstrap ordering

Test the three bootstrap paths:

- [ ] Fresh file (no server state, no `.yjs`): content seeded from `.md`
- [ ] Server has state (restart Obsidian but not the server): content loaded from server
- [ ] Server down, local `.yjs` exists: content loaded from `.yjs` file

### 4. Self-write guard

- [ ] Edit a note, wait for debounce, check that no "External modification detected" warning appears in console
- [ ] Edit the `.md` file externally (e.g. `echo "test" >> file.md`) and verify the warning does appear

## M2: Multi-user co-editing

### 5. Awareness / cursor presence

`yCollab` includes `yRemoteSelections` which renders remote cursors when awareness is passed. To test this without the sidecar:

- Write a small Node script (`test-scripts/fake-peer.ts`) that connects to a room via `y-websocket`, sets awareness state with a fake user, and moves the cursor position on an interval. Verify the cursor appears in Obsidian.

The standalone `awareness.ts` module is available if the built-in rendering needs customization (e.g. always-visible labels instead of hover-only).

### 6. Session lifecycle hardening

- Test rapid file switching (click through many notes quickly)
- Test opening/closing split panes
- Test plugin disable/enable cycle
- Verify no WebSocket connection leaks (check server `/rooms` endpoint)

### 7. Settings panel

- Change server URL, verify reconnection
- Change display name/color, verify awareness updates

## M3: Agent sidecar + MCP

### 8. Wire up MCP server

Implement `sidecar/src/index.ts` using `@modelcontextprotocol/sdk`:

- stdio transport for Claude Desktop
- Connect to the y-websocket server as a peer
- Map each MCP tool to `AgentDocumentSession` methods
- Handle session lifecycle (connect/disconnect per room)
- Set awareness: `{ user: { name: 'Claude Agent', color: '#8B5CF6' }, cursor: null }`

### 9. `list_open_rooms` tool

Wire to `GET /rooms` on the server. Returns room names and client counts.

### 10. `insert_after_heading` tool

Not yet implemented in `AgentDocumentSession`. Add a method that:

- Splits document into lines
- Finds a line matching `^#{1,6}\s+{heading}` (case-insensitive)
- Inserts text after that line
- Wraps regex in try/catch like `insertAfterPattern`

### 11. Claude Desktop integration test

- Configure `claude_desktop_config.json` to point at the sidecar
- Open a note in Obsidian
- Ask Claude to read the note, make an edit, and verify it appears in real time
- Verify Claude's cursor appears in Obsidian

## M4: Polish

### 12. Reconnection handling

- Server goes down → plugin should retry with exponential backoff
- `y-websocket` has built-in reconnection but verify it works cleanly
- Surface connection status in the Obsidian status bar

### 13. External modification handling

Currently logs a warning and ignores. Consider:

- Showing a notice in Obsidian ("File modified externally, Yjs state is authoritative")
- Optionally offering to re-import from `.md` (dangerous — loses Yjs history)

### 14. Automated tests

- Unit tests for `AgentDocumentSession` (pure Yjs, no network)
- Integration test: spin up server, connect two `y-websocket` clients, verify edits sync
- Test bootstrap ordering with mocked vault

### 15. Documentation

- Architecture diagram (Mermaid) in README
- Claude Desktop MCP setup guide
- Troubleshooting section (common issues: duplicate yjs, connection refused, etc.)

## Future / stretch

- **Block model:** Split document into `Y.Array<Y.Map>` with per-block `Y.Text` for structural conflict safety. Significant complexity increase.
- **SSE transport:** For the MCP server, to support web-based LLM clients.
- **Authentication:** Token-based auth on the WS server for non-local use.
- **Conflict visualization:** See `test-vault/Projects/Project Beta.md` for ideas.
- **Offline editing:** Queue Yjs updates locally and sync when server is reachable.
