import { App, PluginSettingTab, Setting } from "obsidian";
import type CRDTCoEditorPlugin from "./main";

export interface CRDTCoEditorSettings {
  serverUrl: string;
  userName: string;
  userColor: string;
  debugLogging: boolean;
  collabPort: number;
  collabHost: string;
}

export const DEFAULT_SETTINGS: CRDTCoEditorSettings = {
  serverUrl: "ws://localhost:1234",
  userName: "Anonymous",
  userColor: "#3B82F6",
  debugLogging: false,
  collabPort: 1234,
  collabHost: "0.0.0.0",
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
      .setName("WebSocket server URL")
      .setDesc("URL of the y-websocket relay server (used when joining)")
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
      .setName("Server port")
      .setDesc("Port for the hosted collaboration server")
      .addText((text) =>
        text
          .setPlaceholder("1234")
          .setValue(String(this.plugin.settings.collabPort))
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.plugin.settings.collabPort = port;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Server bind address")
      .setDesc(
        "0.0.0.0 allows LAN connections; 127.0.0.1 restricts to this machine only"
      )
      .addText((text) =>
        text
          .setPlaceholder("0.0.0.0")
          .setValue(this.plugin.settings.collabHost)
          .onChange(async (value) => {
            this.plugin.settings.collabHost = value;
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
