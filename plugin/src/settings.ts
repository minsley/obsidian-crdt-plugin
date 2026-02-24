import { App, PluginSettingTab, Setting } from "obsidian";
import type CRDTCoEditorPlugin from "./main";

export interface CRDTCoEditorSettings {
  serverUrl: string;
  userName: string;
  userColor: string;
}

export const DEFAULT_SETTINGS: CRDTCoEditorSettings = {
  serverUrl: "ws://localhost:1234",
  userName: "Anonymous",
  userColor: "#3B82F6",
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

    new Setting(containerEl)
      .setName("WebSocket server URL")
      .setDesc("URL of the y-websocket relay server")
      .addText((text) =>
        text
          .setPlaceholder("ws://localhost:1234")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value;
            await this.plugin.saveSettings();
          })
      );

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
  }
}
