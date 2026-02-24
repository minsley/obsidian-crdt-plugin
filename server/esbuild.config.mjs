import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["server/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "server/dist/server.js",
  // Keep node builtins external (they're available at runtime)
  external: ["node:*", "fs", "path", "http", "https", "net", "os", "crypto", "stream", "url", "util", "events", "buffer", "child_process"],
  // Bundle everything else (ws, yjs, y-websocket, level, etc.)
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

console.log("Server built → server/dist/server.js");
