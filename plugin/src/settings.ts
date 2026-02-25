import { App, PluginSettingTab, Setting } from "obsidian";
import type CRDTCoEditorPlugin from "./main";

export interface CRDTCoEditorSettings {
  signalingUrl: string;
  userName: string;
  userColor: string;
  debugLogging: boolean;
}

export const DEFAULT_SETTINGS: CRDTCoEditorSettings = {
  signalingUrl: "ws://localhost:4444",
  userName: "Anonymous",
  userColor: "#3B82F6",
  debugLogging: false,
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
      .setDesc("WebRTC signaling server for peer discovery. Default is the public yjs.dev server.")
      .addText((text) =>
        text
          .setPlaceholder("wss://signaling.yjs.dev")
          .setValue(this.plugin.settings.signalingUrl)
          .onChange(async (value) => {
            this.plugin.settings.signalingUrl = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Identity" });

    new Setting(containerEl)
      .setName("Display name")
      .setDesc("Your name shown to other collaborators")
      .addText((text) =>
        text
          .setPlaceholder("Anonymous")
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Cursor color")
      .setDesc("Your cursor color shown to other collaborators")
      .addText((text) =>
        text
          .setPlaceholder("#3B82F6")
          .setValue(this.plugin.settings.userColor)
          .onChange(async (value) => {
            this.plugin.settings.userColor = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Log verbose CRDT lifecycle events to the developer console")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugLogging)
          .onChange(async (value) => {
            this.plugin.settings.debugLogging = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
