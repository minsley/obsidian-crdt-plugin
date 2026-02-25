import { App, PluginSettingTab, Setting } from "obsidian";
import { generateName, colorForPeerIndex } from "./identity";
import type CRDTCoEditorPlugin from "./main";

export interface CRDTCoEditorSettings {
  signalingUrl: string;
  userName: string;
  userColor: string;
  debugLogging: boolean;
  unlinkWarningDismissed: boolean;
}

export const DEFAULT_SETTINGS: CRDTCoEditorSettings = {
  signalingUrl: "ws://localhost:4444",
  userName: "",
  userColor: "",
  debugLogging: false,
  unlinkWarningDismissed: false,
};

export class CRDTCoEditorSettingTab extends PluginSettingTab {
  plugin: CRDTCoEditorPlugin;

  constructor(app: App, plugin: CRDTCoEditorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h3", { text: "Connection" });

    new Setting(containerEl)
      .setName("Signaling server URL")
      .setDesc(
        "WebRTC signaling server for peer discovery. Default is the local self-hosted server."
      )
      .addText((text) =>
        text
          .setPlaceholder("ws://localhost:4444")
          .setValue(this.plugin.settings.signalingUrl)
          .onChange(async (value) => {
            this.plugin.settings.signalingUrl = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Identity" });

    // Preview element shown next to the Roll button
    const previewEl = containerEl.createDiv({ cls: "collab-identity-preview" });
    this.renderIdentityPreview(previewEl);

    new Setting(containerEl)
      .setName("Display name")
      .setDesc(
        "Your name shown to other collaborators. Leave blank to auto-generate on first session."
      )
      .addText((text) =>
        text
          .setPlaceholder("Will be auto-generated")
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
            this.renderIdentityPreview(previewEl);
          })
      );

    new Setting(containerEl)
      .setName("Cursor color")
      .setDesc("Your cursor color shown to other collaborators.")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.userColor || colorForPeerIndex(0))
          .onChange(async (value) => {
            this.plugin.settings.userColor = value;
            await this.plugin.saveSettings();
            this.renderIdentityPreview(previewEl);
          })
      );

    new Setting(containerEl)
      .setName("Roll new identity")
      .setDesc("Generate a random name and color.")
      .addButton((btn) =>
        btn.setButtonText("Roll").onClick(async () => {
          this.plugin.settings.userName = generateName();
          this.plugin.settings.userColor =
            colorForPeerIndex(Math.floor(Math.random() * 8));
          await this.plugin.saveSettings();
          // Re-render to update text fields and preview
          this.display();
        })
      );

    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc(
        "Log verbose CRDT lifecycle events to the developer console"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugLogging)
          .onChange(async (value) => {
            this.plugin.settings.debugLogging = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderIdentityPreview(el: HTMLElement) {
    el.empty();
    const name = this.plugin.settings.userName || "(auto-generated)";
    const color = this.plugin.settings.userColor || colorForPeerIndex(0);

    const swatch = el.createSpan({ cls: "collab-color-swatch" });
    swatch.style.backgroundColor = color;
    el.createSpan({ text: name });
  }
}
