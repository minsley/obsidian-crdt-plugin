import { App, TFile } from "obsidian";

const FRONTMATTER_KEY = "collab-id";

export function getCollabId(app: App, file: TFile): string | null {
  return (
    app.metadataCache.getFileCache(file)?.frontmatter?.[FRONTMATTER_KEY] ?? null
  );
}

export async function setCollabId(
  app: App,
  file: TFile,
  uuid: string
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[FRONTMATTER_KEY] = uuid;
  });
}

export async function removeCollabId(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    delete fm[FRONTMATTER_KEY];
  });
}

export function findFileByCollabId(app: App, uuid: string): TFile | null {
  for (const file of app.vault.getMarkdownFiles()) {
    if (getCollabId(app, file) === uuid) return file;
  }
  return null;
}
