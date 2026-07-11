import i18next from "i18next";
import { PluginSettingTab, Setting } from "obsidian";
import type HaloPlugin from "./main";
import { HaloSitesModal } from "./sites-modal";

export interface HaloSite {
  name: string;
  url: string;
  token: string;
  default: boolean;
}

export interface ImageUploadCacheEntry {
  filePath: string;
  linkType?: "markdown" | "wiki";
  provider?: ImageUploadProvider;
  size: number;
  mtime: number;
  permalink: string;
  updatedAt: number;
  wikiAlias?: string;
}

export type ImageUploadProvider = "halo" | "openlist";

export interface OpenListSettings {
  siteUrl: string;
  username: string;
  password: string;
  uploadPath: string;
  createDateFolders: boolean;
  tokenEndpoint: string;
}

export interface HaloSetting {
  sites: HaloSite[];
  publishByDefault: boolean;
  replaceImageLinks: boolean;
  imageUploadProvider: ImageUploadProvider;
  openList: OpenListSettings;
  imageUploadCache: Record<string, Record<string, ImageUploadCacheEntry>>;
}

export const DEFAULT_OPENLIST_SETTINGS: OpenListSettings = {
  siteUrl: "",
  username: "",
  password: "",
  uploadPath: "",
  createDateFolders: true,
  tokenEndpoint: "/api/auth/login",
};

export const DEFAULT_SETTINGS: HaloSetting = {
  sites: [],
  publishByDefault: false,
  replaceImageLinks: true,
  imageUploadProvider: "halo",
  openList: DEFAULT_OPENLIST_SETTINGS,
  imageUploadCache: {},
};

export function normalizeSiteUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function normalizeSite(site: HaloSite): HaloSite {
  return {
    ...site,
    url: normalizeSiteUrl(site.url),
  };
}

export function isSameSiteUrl(left: string, right: string): boolean {
  return normalizeSiteUrl(left) === normalizeSiteUrl(right);
}

export function normalizeOpenListSettings(settings: OpenListSettings): OpenListSettings {
  return {
    ...DEFAULT_OPENLIST_SETTINGS,
    ...settings,
    siteUrl: normalizeSiteUrl(settings.siteUrl || ""),
    uploadPath: normalizeOpenListUploadPath(settings.uploadPath || ""),
    createDateFolders: settings.createDateFolders ?? DEFAULT_OPENLIST_SETTINGS.createDateFolders,
    tokenEndpoint: settings.tokenEndpoint?.trim() || DEFAULT_OPENLIST_SETTINGS.tokenEndpoint,
  };
}

export function normalizeOpenListUploadPath(path: string): string {
  const trimmed = path.trim();

  if (!trimmed) {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

export class HaloSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: HaloPlugin) {
    super(plugin.app, plugin);
  }

  display() {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName(i18next.t("settings.site.name"))
      .setDesc(i18next.t("settings.site.description"))
      .addButton((button) =>
        button.setButtonText(i18next.t("settings.site.actions.open")).onClick(() => {
          new HaloSitesModal(this.plugin).open();
        }),
      );

    new Setting(containerEl)
      .setName(i18next.t("settings.publishByDefault.name"))
      .setDesc(i18next.t("settings.publishByDefault.description"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.publishByDefault).onChange((value) => {
          this.plugin.settings.publishByDefault = value;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(i18next.t("settings.replaceImageLinks.name"))
      .setDesc(i18next.t("settings.replaceImageLinks.description"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.replaceImageLinks).onChange((value) => {
          this.plugin.settings.replaceImageLinks = value;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(i18next.t("settings.imageUploadProvider.name"))
      .setDesc(i18next.t("settings.imageUploadProvider.description"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("halo", i18next.t("settings.imageUploadProvider.options.halo"))
          .addOption("openlist", i18next.t("settings.imageUploadProvider.options.openlist"))
          .setValue(this.plugin.settings.imageUploadProvider)
          .onChange((value) => {
            this.plugin.settings.imageUploadProvider = value as HaloSetting["imageUploadProvider"];
            this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.imageUploadProvider === "openlist") {
      new Setting(containerEl)
        .setName(i18next.t("settings.openList.siteUrl.name"))
        .setDesc(i18next.t("settings.openList.siteUrl.description"))
        .addText((text) =>
          text.setValue(this.plugin.settings.openList.siteUrl).onChange((value) => {
            this.plugin.settings.openList.siteUrl = value;
            this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName(i18next.t("settings.openList.username.name"))
        .setDesc(i18next.t("settings.openList.username.description"))
        .addText((text) =>
          text.setValue(this.plugin.settings.openList.username).onChange((value) => {
            this.plugin.settings.openList.username = value;
            this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName(i18next.t("settings.openList.password.name"))
        .setDesc(i18next.t("settings.openList.password.description"))
        .addText((text) => {
          text.inputEl.type = "password";
          text.setValue(this.plugin.settings.openList.password).onChange((value) => {
            this.plugin.settings.openList.password = value;
            this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName(i18next.t("settings.openList.uploadPath.name"))
        .setDesc(i18next.t("settings.openList.uploadPath.description"))
        .addText((text) =>
          text.setValue(this.plugin.settings.openList.uploadPath).onChange((value) => {
            this.plugin.settings.openList.uploadPath = value;
            this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName(i18next.t("settings.openList.createDateFolders.name"))
        .setDesc(i18next.t("settings.openList.createDateFolders.description"))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.openList.createDateFolders).onChange((value) => {
            this.plugin.settings.openList.createDateFolders = value;
            this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName(i18next.t("settings.openList.tokenEndpoint.name"))
        .setDesc(i18next.t("settings.openList.tokenEndpoint.description"))
        .addText((text) =>
          text.setValue(this.plugin.settings.openList.tokenEndpoint).onChange((value) => {
            this.plugin.settings.openList.tokenEndpoint = value;
            this.plugin.saveSettings();
          }),
        );
    }
  }
}
