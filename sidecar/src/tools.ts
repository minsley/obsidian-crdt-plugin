/**
 * MCP tool definitions — stub for M3.
 * These will be wired up when the MCP server is implemented.
 */

export const TOOL_DEFINITIONS = [
  {
    name: "list_open_rooms",
    description:
      "Lists active rooms on the y-websocket server with client counts",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "connect_to_note",
    description:
      "Connects to a note by vault name and file path, returns session handle",
    inputSchema: {
      type: "object" as const,
      properties: {
        vault: { type: "string", description: "Obsidian vault name" },
        filePath: {
          type: "string",
          description: "Path to the note within the vault",
        },
      },
      required: ["vault", "filePath"],
    },
  },
  {
    name: "read_document",
    description: "Returns full document text for a connected session",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Session handle" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "replace_text",
    description: "Find-and-replace text in the document",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Session handle" },
        search: { type: "string", description: "Text to find" },
        replacement: { type: "string", description: "Replacement text" },
        occurrence: {
          oneOf: [{ type: "number" }, { type: "string", enum: ["all"] }],
          description:
            "Which occurrence to replace (1-indexed) or 'all'. Defaults to 1.",
        },
      },
      required: ["sessionId", "search", "replacement"],
    },
  },
  {
    name: "insert_after_heading",
    description: "Insert text after a markdown heading (matched by heading text)",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Session handle" },
        heading: {
          type: "string",
          description: "Heading text to match (without # prefix)",
        },
        text: { type: "string", description: "Text to insert" },
      },
      required: ["sessionId", "heading", "text"],
    },
  },
  {
    name: "insert_after_pattern",
    description: "Insert text after a regex-matched line",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Session handle" },
        pattern: {
          type: "string",
          description: "Regex pattern to match a line",
        },
        text: { type: "string", description: "Text to insert" },
      },
      required: ["sessionId", "pattern", "text"],
    },
  },
  {
    name: "append_to_document",
    description: "Append text to the end of the document",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Session handle" },
        text: { type: "string", description: "Text to append" },
      },
      required: ["sessionId", "text"],
    },
  },
  {
    name: "disconnect",
    description: "Cleanly disconnect from a room",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Session handle" },
      },
      required: ["sessionId"],
    },
  },
] as const;
