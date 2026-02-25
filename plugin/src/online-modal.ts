import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type CRDTCoEditorPlugin from "./main";

/**
 * Two-panel Host/Join modal.
 *
 * Host path: click Host → transitions in-place to show room code + Copy button.
 * Join path: enter room code → click Join → spinner → discovers UUID via awareness
 *            → finds/creates file → opens session → modal closes.
 */
export class OnlineModal extends Modal {
  constructor(
    app: App,
    private plugin: CRDTCoEditorPlugin,
    private file: TFile
  ) {
    super(app);
  }

  onOpen() {
    this.renderMain();
  }

  onClose() {
    this.contentEl.empty();
  }

  private renderMain() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("collab-online-modal");

    contentEl.createEl("h2", { text: "Go Online" });

    const panels = contentEl.createDiv({ cls: "collab-online-panels" });

    // --- Host panel ---
    const hostPanel = panels.createDiv({ cls: "collab-panel collab-panel-host" });
    hostPanel.createEl("h3", { text: "Host" });
    hostPanel.createEl("p", { text: "Start a new session and share the room code with collaborators." });
    new Setting(hostPanel).addButton((btn) =>
      btn
        .setButtonText("Host")
        .setCta()
        .onClick(() => this.startHost())
    );

    // --- Divider ---
    panels.createDiv({ cls: "collab-panel-divider" });

    // --- Join panel ---
    const joinPanel = panels.createDiv({ cls: "collab-panel collab-panel-join" });
    joinPanel.createEl("h3", { text: "Join" });
    joinPanel.createEl("p", { text: "Connect to an existing session using a room code." });

    let roomCode = "";
    const joinSetting = new Setting(joinPanel)
      .addText((t) =>
        t
          .setPlaceholder("amber-otter-42")
          .onChange((v) => (roomCode = v.trim()))
      )
      .addButton((btn) =>
        btn
          .setButtonText("Join")
          .setCta()
          .onClick(() => this.startJoin(roomCode))
      );

    // Allow submitting with Enter key in the text field
    const textEl = joinSetting.controlEl.querySelector("input");
    if (textEl) {
      textEl.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") this.startJoin(roomCode);
      });
    }
  }

  private startHost() {
    const { contentEl } = this;
    contentEl.empty();

    const roomCode = this.plugin.beginHosting(this.file);

    contentEl.createEl("h2", { text: "Hosting" });
    contentEl.createEl("p", { text: "Share this code with collaborators:" });

    const codeEl = contentEl.createEl("div", { cls: "collab-room-code-display" });
    codeEl.createEl("code", { text: roomCode });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Copy Code").onClick(() => {
          navigator.clipboard.writeText(roomCode);
          new Notice("Room code copied");
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Close").onClick(() => this.close())
      );
  }

  private async startJoin(roomCode: string) {
    if (!roomCode) {
      new Notice("Enter a room code");
      return;
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Joining..." });
    const statusEl = contentEl.createEl("p", { text: "Connecting to room..." });

    try {
      statusEl.setText("Waiting for room info...");
      await this.plugin.joinSession(roomCode);
      this.close();
    } catch (e: any) {
      contentEl.empty();
      contentEl.createEl("h2", { text: "Failed to join" });
      contentEl.createEl("p", { text: e.message });
      new Setting(contentEl).addButton((btn) =>
        btn
          .setButtonText("Back")
          .onClick(() => this.renderMain())
      );
    }
  }
}
