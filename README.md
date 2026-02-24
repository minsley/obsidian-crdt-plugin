# obsidian-crdt-coeditor

Real-time collaborative editing for Obsidian using Yjs CRDTs. Supports multi-user collaboration via room codes and AI agent co-editing via MCP.

## Architecture

```
                          ┌─────────────────┐
                          │  y-websocket     │
  Obsidian A ←── ws ────→│  Server          │←── ws ────→ Obsidian B
  (host)                  │  (LevelDB)       │             (joiner)
                          └────────┬─────────┘
                                   │ ws
                          ┌────────┴─────────┐
                          │  Agent Sidecar   │
                          │  (MCP stdio)     │
                          └────────┬─────────┘
                                   │ MCP
                          ┌────────┴─────────┐
                          │  Claude Desktop  │
                          └──────────────────┘
```

Three components:

- **plugin/** — Obsidian plugin that binds a `Y.Text` to each open markdown file via `y-codemirror.next`. Keystrokes produce Yjs updates that sync through the relay server. Can host a server as a child process or join an existing one via room code. The `.md` file is a one-way export (written on a 1s debounce), not the source of truth.
- **server/** — `y-websocket` relay with LevelDB persistence and a room code registry. Bundled into a single `server.js` that the plugin can spawn directly. Binds to `127.0.0.1` by default.
- **sidecar/** — Node process that connects to the same Yjs document as a peer and exposes editing tools via MCP (stdio transport). Claude Desktop calls tools like `read_document`, `replace_text`, `insert_after_heading`, etc. Shows a labeled remote cursor in the editor.

Room names follow the convention `obsidian/{vaultName}/{filePath}`.

## Current status

Working end-to-end:

- **Solo editing** — CRDT-backed editing with Yjs state persistence (`.yjs` sidecar files).
- **Multi-user** — host starts collab from ribbon icon, shares a room code, others join via command palette. Tested with 3 concurrent peers.
- **Agent co-editing** — Claude connects via MCP sidecar, reads/writes documents, and renders a labeled remote cursor in the editor.
- **Embedded server** — plugin spawns the y-websocket server as a child process (via Electron's Node.js runtime), no external server needed.
- **Split panes** — multiple panes of the same or different files all stay in sync.

See [NEXT-STEPS.md](./NEXT-STEPS.md) for the roadmap.

## Prerequisites

- Node.js >= 18
- npm >= 9 (uses npm workspaces)
- Obsidian >= 1.5.0 (desktop only — requires Node.js access for server hosting)

## Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Or build individually
npm run dev:plugin    # watch mode
npm run dev:server    # watch mode via tsx
npm run dev:sidecar   # watch mode via tsx
```

### Plugin installation

Symlink the plugin build output into your test vault:

```bash
# The test-vault is already configured to load the plugin.
ln -sf "$(pwd)/plugin/dist/main.js" test-vault/.obsidian/plugins/obsidian-crdt-coeditor/main.js
cp plugin/manifest.json test-vault/.obsidian/plugins/obsidian-crdt-coeditor/manifest.json
```

Then open `test-vault/` in Obsidian, go to Settings → Community Plugins, and enable "CRDT Co-Editor".

## Usage

### Solo mode

Enable the plugin. It syncs each open file through the CRDT layer automatically. No server needed for single-user — state is persisted locally in `.yjs` files.

### Multi-user collaboration

1. Click the **users** ribbon icon (or run "Start collaboration" from the command palette).
2. The plugin spawns an embedded server and generates a room code (e.g. `bright-ocean-42`).
3. Share the room code with collaborators.
4. Collaborators run "Join collaboration session" from the command palette, enter the host's URL and room code.
5. Click the ribbon icon again (or "Stop collaboration") to end the session.

### Agent co-editing (Claude via MCP)

1. Build the sidecar: `npm run build -w sidecar`
2. Add to Claude Desktop's MCP config (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "obsidian-crdt": {
         "command": "node",
         "args": ["/path/to/obsidian-crdt-coeditor/sidecar/dist/index.js"],
         "env": {
           "WEBSOCKET_URL": "ws://localhost:1234"
         }
       }
     }
   }
   ```
3. Start collaboration in Obsidian (so the server is running).
4. In Claude Desktop, use tools like `connect_to_note`, `read_document`, `replace_text`, etc.
5. Claude's edits appear in real-time with a labeled purple cursor.

**MCP tools:** `list_open_rooms`, `connect_to_note`, `read_document`, `replace_text`, `insert_after_heading`, `insert_after_pattern`, `append_to_document`, `disconnect`.

## Configuration

Plugin settings (via Obsidian Settings → CRDT Co-Editor):

| Setting | Default | Description |
|---------|---------|-------------|
| WebSocket server URL | `ws://localhost:1234` | Relay server address |
| Display name | `Anonymous` | Shown to other collaborators |
| Cursor color | `#3B82F6` | Your cursor color |
| Collab port | `1234` | Port for the embedded server |
| Collab host | `127.0.0.1` | Bind address for embedded server |
| Debug logging | `false` | Verbose console output |

Server config (via environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `1234` | WebSocket/HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `LEVELDB_PATH` | `./.leveldb` | Persistence directory |

## Server HTTP endpoints

- `GET /health` — returns `{"status": "ok"}`
- `GET /rooms` — lists active rooms with client counts and room codes
- `POST /rooms/create` — register a room code for a room name
- `GET /rooms/lookup/:code` — resolve a room code to a room name

## How persistence works

Two layers:

- **Server-side:** LevelDB stores the full Yjs update history per room.
- **Client-side:** `.md_crdt/{filename}.yjs` stores binary Y.Doc state alongside each markdown file in the vault.

When a file is opened, the plugin waits for sync with the server, then bootstraps:

1. Server has Yjs state → use it.
2. No server state, local `.yjs` file exists → load it.
3. Neither → seed from the `.md` file content.

The `.md` file is written by the plugin on a 1s debounce but is never read back as the source of truth after initial bootstrap.

## Project structure

```
obsidian-crdt-coeditor/
├── plugin/                        # Obsidian plugin (TypeScript, esbuild)
│   └── src/
│       ├── main.ts                # Plugin entry, collab lifecycle, commands
│       ├── session.ts             # CRDTSession: Y.Doc + WebSocket provider
│       ├── cm-extension.ts        # CM6 Compartment-based yCollab binding
│       ├── persistence.ts         # .yjs binary state file I/O
│       ├── server-manager.ts      # Spawns embedded server as child process
│       ├── log.ts                 # Shared logger with debug toggle
│       ├── awareness.ts           # Remote cursor rendering (standalone)
│       └── settings.ts            # Settings tab
├── server/                        # y-websocket relay (Node, esbuild)
│   └── src/
│       ├── index.ts               # WS + HTTP server, room code endpoints
│       ├── room-codes.ts          # Ephemeral room code registry
│       └── config.ts              # Config from env vars
├── sidecar/                       # Agent MCP server (Node, esbuild)
│   └── src/
│       ├── index.ts               # MCP server entry (8 tools)
│       ├── session-manager.ts     # y-websocket connection management
│       ├── document-session.ts    # High-level edit API, cursor awareness
│       ├── tools.ts               # MCP tool definitions
│       └── config.ts              # Config from env vars
├── test-vault/                    # Obsidian vault for development
├── NEXT-STEPS.md                  # Roadmap and feature plans
└── obsidian-crdt-coeditor-plan.md # Original project plan
```

## Known limitations

- **Desktop only.** The embedded server requires Node.js access via Electron's runtime. Obsidian Mobile is not supported.
- **Incompatible with Obsidian Sync and iCloud sync** for files being co-edited. Those systems write directly to `.md` files and will conflict with Yjs-managed exports.
- **External `.md` modifications are ignored.** If you edit the `.md` file outside Obsidian while a CRDT session is active, the Yjs state takes precedence.
- **No authentication.** The server is for local/trusted network use. Do not expose it to the internet without adding auth.
- **Single `Y.Text` per file.** No block-level CRDT — the entire file is one Y.Text. Concurrent edits to the same line merge character-by-character.

## License

TBD
