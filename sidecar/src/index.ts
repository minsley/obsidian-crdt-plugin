import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { SessionManager } from "./session-manager.js";

const config = loadConfig();
const sessions = new SessionManager(config);

const server = new McpServer({
  name: "obsidian-crdt-coeditor",
  version: "0.1.0",
});

// --- Tools ---

server.tool(
  "list_open_rooms",
  "Lists active rooms on the y-websocket server with client counts",
  {},
  async () => {
    try {
      const res = await fetch(`${config.serverHttpUrl}/rooms`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error fetching rooms: ${e.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "connect_to_note",
  "Connect to an Obsidian note for collaborative editing. Returns a session ID.",
  {
    vault: z.string().describe("Obsidian vault name"),
    filePath: z.string().describe("Path to the note within the vault (e.g. 'Welcome.md')"),
  },
  async ({ vault, filePath }) => {
    try {
      const session = await sessions.connect(vault, filePath);
      const preview = session.docSession.read().slice(0, 200);
      return {
        content: [
          {
            type: "text",
            text: `Connected to ${filePath}. Session ID: ${session.id}\n\nPreview:\n${preview}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error connecting: ${e.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "read_document",
  "Read the full text of a connected document",
  {
    sessionId: z.string().describe("Session ID from connect_to_note"),
  },
  async ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: "text", text: `Unknown session: ${sessionId}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: session.docSession.read() }],
    };
  }
);

server.tool(
  "replace_text",
  "Find and replace text in the document. Edits appear in real-time in Obsidian.",
  {
    sessionId: z.string().describe("Session ID from connect_to_note"),
    search: z.string().describe("Exact text to find"),
    replacement: z.string().describe("Text to replace it with"),
    occurrence: z
      .union([z.number().int().positive(), z.literal("all")])
      .default(1)
      .describe("Which occurrence to replace (1-indexed) or 'all'. Default: 1"),
  },
  async ({ sessionId, search, replacement, occurrence }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: "text", text: `Unknown session: ${sessionId}` }],
        isError: true,
      };
    }
    const result = session.docSession.replace(search, replacement, occurrence);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.success,
    };
  }
);

server.tool(
  "insert_after_heading",
  "Insert text after a markdown heading (matched by heading text, case-insensitive)",
  {
    sessionId: z.string().describe("Session ID from connect_to_note"),
    heading: z.string().describe("Heading text to match (without # prefix)"),
    text: z.string().describe("Text to insert after the heading line"),
  },
  async ({ sessionId, heading, text }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: "text", text: `Unknown session: ${sessionId}` }],
        isError: true,
      };
    }
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = `^#{1,6}\\s+${escaped}\\s*$`;
    const result = session.docSession.insertAfterPattern(pattern, text);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.success,
    };
  }
);

server.tool(
  "insert_after_pattern",
  "Insert text after the first line matching a regex pattern",
  {
    sessionId: z.string().describe("Session ID from connect_to_note"),
    pattern: z.string().describe("Regex pattern to match a line"),
    text: z.string().describe("Text to insert after the matched line"),
  },
  async ({ sessionId, pattern, text }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: "text", text: `Unknown session: ${sessionId}` }],
        isError: true,
      };
    }
    const result = session.docSession.insertAfterPattern(pattern, text);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.success,
    };
  }
);

server.tool(
  "append_to_document",
  "Append text to the end of the document",
  {
    sessionId: z.string().describe("Session ID from connect_to_note"),
    text: z.string().describe("Text to append"),
  },
  async ({ sessionId, text }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: "text", text: `Unknown session: ${sessionId}` }],
        isError: true,
      };
    }
    session.docSession.append(text);
    return {
      content: [{ type: "text", text: "Text appended." }],
    };
  }
);

server.tool(
  "disconnect",
  "Disconnect from a document session",
  {
    sessionId: z.string().describe("Session ID to disconnect"),
  },
  async ({ sessionId }) => {
    const ok = sessions.disconnect(sessionId);
    return {
      content: [
        {
          type: "text",
          text: ok ? "Disconnected." : `Unknown session: ${sessionId}`,
        },
      ],
      isError: !ok,
    };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[crdt-coeditor sidecar] MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[crdt-coeditor sidecar] Fatal: ${err}\n`);
  process.exit(1);
});

process.on("SIGINT", () => {
  sessions.disconnectAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  sessions.disconnectAll();
  process.exit(0);
});
