import { Vault } from "obsidian";
import * as Y from "yjs";

/**
 * File-based Yjs persistence.
 * Stores binary Y.Doc state as `.md_crdt/{filename}.yjs` alongside the markdown file.
 */

function crdtPath(filePath: string): string {
  const dir = filePath.substring(0, filePath.lastIndexOf("/") + 1);
  const basename = filePath.substring(filePath.lastIndexOf("/") + 1);
  return `${dir}.md_crdt/${basename}.yjs`;
}

export async function loadYjsState(
  vault: Vault,
  filePath: string,
  ydoc: Y.Doc
): Promise<boolean> {
  const path = crdtPath(filePath);
  try {
    const data = await vault.adapter.readBinary(path);
    Y.applyUpdate(ydoc, new Uint8Array(data));
    return true;
  } catch {
    // No existing state file
    return false;
  }
}

export async function saveYjsState(
  vault: Vault,
  filePath: string,
  ydoc: Y.Doc
): Promise<void> {
  const path = crdtPath(filePath);
  const dir = path.substring(0, path.lastIndexOf("/"));

  // Ensure .md_crdt directory exists
  if (!(await vault.adapter.exists(dir))) {
    await vault.adapter.mkdir(dir);
  }

  const state = Y.encodeStateAsUpdate(ydoc);
  await vault.adapter.writeBinary(path, state.buffer as ArrayBuffer);
}
