/**
 * Agent sidecar MCP server — stub entry point for M3.
 *
 * In M1/M2 this file is not used. The full MCP server implementation
 * will be built in M3 using @modelcontextprotocol/sdk with stdio transport.
 */

import { loadConfig } from "./config.js";

const config = loadConfig();

console.log("[crdt-coeditor sidecar] MCP server stub");
console.log(`[crdt-coeditor sidecar] WS server URL: ${config.serverUrl}`);
console.log(
  "[crdt-coeditor sidecar] This is a placeholder — full MCP implementation comes in M3."
);
