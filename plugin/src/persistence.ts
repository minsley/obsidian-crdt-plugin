import { App } from "obsidian";
import * as Y from "yjs";

/**
 * UUID-keyed Yjs persistence in the plugin folder.
 * Path: {vault}/.obsidian/plugins/obsidian-crdt-coeditor/yjs/{uuid}
 *
 * Stored in the plugin folder so Obsidian Sync replicates it alongside
 * the markdown file (which carries the collab-id frontmatter UUID).
 */

function yjsPath(app: App, uuid: string): string {
  return `${app.vault.configDir}/plugins/obsidian-crdt-coeditor/yjs/${uuid}`;
}

export async function loadYjsState(
  app: App,
  uuid: string,
  doc: Y.Doc
): Promise<boolean> {
  const path = yjsPath(app, uuid);
  try {
    const data = await app.vault.adapter.readBinary(path);
    Y.applyUpdate(doc, new Uint8Array(data));
    return true;
  } catch {
    return false;
  }
}

export async function saveYjsState(
  app: App,
  uuid: string,
  doc: Y.Doc
): Promise<void> {
  const path = yjsPath(app, uuid);
  const dir = path.substring(0, path.lastIndexOf("/"));
  try {
    await app.vault.adapter.mkdir(dir);
  } catch {
    // already exists
  }
  const state = Y.encodeStateAsUpdate(doc);
  await app.vault.adapter.writeBinary(path, state.buffer as ArrayBuffer);
}

export async function deleteYjsState(app: App, uuid: string): Promise<void> {
  try {
    await app.vault.adapter.remove(yjsPath(app, uuid));
  } catch {
    // file may not exist
  }
}
