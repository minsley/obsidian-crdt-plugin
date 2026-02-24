# Project Alpha — CRDT Co-Editor

#project #active

## Overview

Project Alpha is the core implementation of real-time collaborative editing for Obsidian using Yjs CRDTs. The system consists of three components: an Obsidian plugin, a y-websocket relay server, and an agent sidecar that exposes editing capabilities via MCP.

## Architecture

The plugin runs inside Obsidian and binds a `Y.Text` instance to each open markdown file via `y-codemirror.next`. All Yjs updates flow through a central y-websocket relay server that persists state to LevelDB.

```
Plugin ←→ WS Server ←→ Agent Sidecar ←→ Claude Desktop
```

The agent sidecar connects as a regular Yjs peer and exposes high-level editing tools:

```typescript
interface EditTools {
  read_document(): string;
  replace_text(search: string, replacement: string): boolean;
  insert_after_heading(heading: string, text: string): boolean;
  append_to_document(text: string): void;
}
```

## Room Naming

Each file gets a unique room name:

```
obsidian/{vaultName}/{filePath}
```

For example: `obsidian/test-vault/Projects/Project Alpha.md`

## Technical Constraints

### Bootstrap Ordering

When a file is opened, the plugin must wait for `provider.on('synced')` before deciding how to initialize:

1. Server has state → use it
2. Local `.yjs` file exists → load it
3. Neither → seed from `.md` file

### Persistence

Two layers of persistence:

- **Server-side:** LevelDB stores the full Yjs update history per room
- **Client-side:** `.md_crdt/{filename}.yjs` stores binary Y.Doc state alongside the markdown file

The `.md` file itself is a one-way export — it is written by the plugin on a 1s debounce but never read back as the source of truth (except during initial bootstrap with no Yjs state).

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| yjs | ^13.6.0 | CRDT implementation |
| y-websocket | ^2.0.0 | WebSocket sync provider |
| y-codemirror.next | ^0.3.5 | CM6 binding |
| y-leveldb | ^0.1.2 | Server persistence |

## Related

- [[Meeting Notes/2025-01-15 Kickoff]]
- [[Meeting Notes/2025-02-01 Sprint Review]]
- [[Projects/Project Beta]]

## Status

Currently in **M1** — single-user local sync. See the [[Meeting Notes/2025-02-01 Sprint Review|sprint review]] for current progress.
