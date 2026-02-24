import esbuild from "esbuild";
import process from "process";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const watch = process.argv.includes("--watch");

// Resolve the single canonical yjs dist file. Using the pre-built dist/yjs.mjs
// ensures ALL code (including the singleton check) lives in one module. The old
// approach of pointing to src/index.js still allowed dist/yjs.mjs to sneak in
// via subpath imports, creating the "Yjs was already imported" warning.
const yjsPath = path.dirname(require.resolve("yjs/package.json"));
const yjsDistFile = path.join(yjsPath, "dist/yjs.mjs");

const dedupeYjsPlugin = {
  name: "dedupe-yjs",
  setup(build) {
    // Force ALL yjs imports (bare and subpath) to the single dist file
    build.onResolve({ filter: /^yjs(\/|$)/ }, () => ({
      path: yjsDistFile,
    }));
    // Dedupe lib0 — resolve every lib0 import through the same root
    const lib0Path = path.dirname(require.resolve("lib0/package.json"));
    build.onResolve({ filter: /^lib0(\/|$)/ }, (args) => {
      if (args.path === "lib0") {
        return { path: require.resolve("lib0") };
      }
      // For subpaths like lib0/observable, lib0/encoding, etc.
      try {
        return { path: require.resolve(args.path) };
      } catch {
        return undefined;
      }
    });
  },
};

// Mark Node built-ins as external so lib0's node-specific conditional
// imports don't break the browser-targeted bundle.
const nodeBuiltins = [
  "node:crypto", "crypto",
  "node:fs", "fs",
  "node:path", "path",
  "node:os", "os",
  "node:child_process", "child_process",
  "node:module",
];

const context = await esbuild.context({
  entryPoints: [path.resolve(__dirname, "src/main.ts")],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/language",
    "@codemirror/autocomplete",
    "@codemirror/commands",
    "@codemirror/lint",
    "@codemirror/search",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...nodeBuiltins,
  ],
  plugins: [dedupeYjsPlugin],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: "inline",
  treeShaking: true,
  outfile: path.resolve(__dirname, "dist/main.js"),
});

if (watch) {
  await context.watch();
  console.log("Watching for changes...");
} else {
  await context.rebuild();
  process.exit(0);
}
