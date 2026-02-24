# obsidian-crdt-coeditor

Real-time collaborative editing for Obsidian using Yjs CRDTs, with an agent sidecar that lets LLMs co-edit notes via MCP.

A human and an AI agent edit the same Obsidian note simultaneously, with presence and cursors visible to both sides.

## Architecture

```
Obsidian Plugin ←─ WebSocket ─→ y-websocket Server ←─ WebSocket ─→ Agent Sidecar ←─ MCP ─→ Claude Desktop
  (CM6 + Yjs)                    (LevelDB persistence)              (edit API)
```

Three components:

- **plugin/** — Obsidian plugin that binds a `Y.Text` to each open markdown file via `y-codemirror.next`. Keystrokes produce Yjs updates that sync through the relay server. The `.md` file is a one-way export (written on a 1s debounce), not the source of truth.
- **server/** — `y-websocket` relay with LevelDB persistence. Stores the full Yjs update history per room. Binds to `127.0.0.1` by default.
- **sidecar/** — Node process that connects to the same Yjs document as a peer and exposes editing tools via MCP (stdio transport). Claude Desktop calls tools like `read_document`, `replace_text`, `insert_after_heading`, etc.

Room names follow the convention `obsidian/{vaultName}/{filePath}`.

## Prerequisites

- Node.js >= 18
- npm >= 9 (uses npm workspaces; pnpm also supported via `pnpm-workspace.yaml`)
- Obsidian >= 1.5.0

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
# Just symlink the build output:
ln -sf "$(pwd)/plugin/dist/main.js" test-vault/.obsidian/plugins/obsidian-crdt-coeditor/main.js
cp plugin/manifest.json test-vault/.obsidian/plugins/obsidian-crdt-coeditor/manifest.json
```

Then open `test-vault/` in Obsidian, go to Settings → Community Plugins, and enable "CRDT Co-Editor".

### Running

1. Start the server:
   ```bash
   npm run dev:server
   ```
2. Open the test vault in Obsidian. The plugin connects automatically to `ws://localhost:1234`.
3. (M3) Start the sidecar and configure Claude Desktop to use it as an MCP server.

## Configuration

Plugin settings (via Obsidian Settings → CRDT Co-Editor):

| Setting | Default | Description |
|---------|---------|-------------|
| WebSocket server URL | `ws://localhost:1234` | Relay server address |
| Display name | `Anonymous` | Shown to other collaborators |
| Cursor color | `#3B82F6` | Your cursor color |

Server config (via environment variables or `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `1234` | WebSocket/HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `LEVELDB_PATH` | `./.leveldb` | Persistence directory |

## Server HTTP endpoints

- `GET /rooms` — lists active rooms with client counts
- `GET /health` — returns `{"status": "ok"}`

## How persistence works

Two layers:

- **Server-side:** LevelDB stores the full Yjs update history per room.
- **Client-side:** `.md_crdt/{filename}.yjs` stores binary Y.Doc state alongside each markdown file in the vault.

When a file is opened, the plugin waits for sync with the server, then decides how to bootstrap:

1. Server has Yjs state → use it
2. No server state, local `.yjs` file exists → load it
3. Neither → seed from the `.md` file

The `.md` file is written by the plugin on a 1s debounce but is never read back as the source of truth after initial bootstrap.

## Known limitations

- **Incompatible with Obsidian Sync and iCloud sync** for files being co-edited. Those systems write directly to `.md` files and will conflict with the Yjs-managed exports. Use git for version history instead.
- **External `.md` modifications are ignored.** If you edit the `.md` file outside Obsidian (e.g. `git pull`), the Yjs state takes precedence. A warning is logged to the console.
- **No authentication.** The server is intended for local use only. Do not expose it to the internet without adding auth.
- **Single `Y.Text` per file.** No block-level CRDT model — the entire file is one Y.Text. This is fine for notes where users work on different sections, but concurrent edits to the same line will merge character-by-character.
- **Agent sidecar is a stub** in the current milestone. MCP tool wiring comes in M3.

## Project structure

```
obsidian-crdt-coeditor/
├── plugin/                     # Obsidian plugin (TypeScript, esbuild)
│   └── src/
│       ├── main.ts             # Plugin entry point, session lifecycle
│       ├── session.ts          # CRDTSession: Y.Doc + WebSocket provider
│       ├── cm-extension.ts     # CM6 Compartment-based yCollab binding
│       ├── persistence.ts      # .yjs binary state file I/O
│       ├── awareness.ts        # Remote cursor rendering (standalone)
│       └── settings.ts         # Settings tab
├── server/                     # y-websocket relay (Node, esbuild)
│   └── src/
│       ├── index.ts            # WS + HTTP server, room registry
│       └── config.ts           # Config from env vars
├── sidecar/                    # Agent MCP server (Node, esbuild)
│   └── src/
│       ├── index.ts            # Entry point (stub)
│       ├── document-session.ts # AgentDocumentSession edit API
│       ├── tools.ts            # MCP tool definitions
│       └── config.ts           # Config from env vars
├── test-vault/                 # Obsidian vault with dummy notes
└── obsidian-crdt-coeditor-plan.md  # Full project plan
```

## Test vault

`test-vault/` is a minimal Obsidian vault for development. It contains:

- `Welcome.md` — short intro with internal links
- `Meeting Notes/` — two meeting notes with headings, bullets, action items, tags
- `Projects/Project Alpha.md` — longer note (~60 lines) with code blocks, tables, links
- `Projects/Project Beta.md` — shorter note
- `Scratch.md` — empty file (tests bootstrap from empty `.md`)

## License

TBD
