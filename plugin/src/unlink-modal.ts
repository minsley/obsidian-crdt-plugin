import { App, Modal, Setting } from "obsidian";

/**
 * Warning modal shown before unlinking a collaborative file.
 * Has a "don't show again" checkbox backed by plugin settings.
 * Resolves true (proceed) or false (cancelled).
 */
export class UnlinkWarningModal extends Modal {
  private resolved = false;
  private dontShowAgain = false;
  private resolve!: (result: { proceed: boolean; dismiss: boolean }) => void;

  constructor(app: App) {
    super(app);
  }

  open(): Promise<{ proceed: boolean; dismiss: boolean }> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Unlink Collaboration" });
    contentEl.createEl("p", {
      text: "This will remove the collaboration ID and delete the shared edit history for this file. Other peers will lose sync with your copy.",
    });
    contentEl.createEl("p", {
      text: "You can restore within this session if you change your mind.",
      cls: "mod-muted",
    });

    new Setting(contentEl)
      .setName("Don't show this warning again")
      .addToggle((t) => t.setValue(false).onChange((v) => (this.dontShowAgain = v)));

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText("Unlink")
          .setWarning()
          .onClick(() => {
            this.resolved = true;
            this.close();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
    this.resolve({
      proceed: this.resolved,
      dismiss: this.dontShowAgain,
    });
  }
}
