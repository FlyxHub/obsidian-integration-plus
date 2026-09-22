import type { SecretStorage } from "obsidian";
import {
	ConfluenceUploadSettings,
	DEFAULT_KROKI_SETTINGS,
	type ConfluenceSettingsValidationIssue,
} from "@markdown-confluence/lib";
import type { BrowserOAuthSettings } from "./BrowserOAuth";

export const MERMAID_THEMES = {
	"match-obsidian": "Match Obsidian",
	"light-obsidian": "Obsidian light",
	"dark-obsidian": "Obsidian dark",
	default: "Mermaid default",
	neutral: "Mermaid neutral",
	dark: "Mermaid dark",
	forest: "Mermaid forest",
} as const;

export type MermaidTheme = keyof typeof MERMAID_THEMES;

export function isMermaidTheme(value: string): value is MermaidTheme {
	return Object.prototype.hasOwnProperty.call(MERMAID_THEMES, value);
}

export interface ObsidianPluginSettings
	extends ConfluenceUploadSettings.ConfluenceSettings, BrowserOAuthSettings {
	showPublishResultsModal: boolean;
	renderDataview: boolean;
	/** When pulling all notes, create notes for new pages under the parent page. */
	importNewPages: boolean;
	/** Vault folder where pull saves images and other attachments. */
	imageFolder: string;
	/** Published images wider than this many pixels are scaled down to it; 0 for no limit. */
	maxImageWidth: number;
	mermaidTheme: MermaidTheme;
	/** Name of the SecretStorage entry that holds the API token or PAT. */
	apiTokenSecretName: string;
	/** Name of the SecretStorage entry that holds the service-account client secret. */
	clientSecretSecretName: string;
}

const PLUGIN_DEFAULTS = {
	mermaidTheme: "match-obsidian",
	showPublishResultsModal: true,
	renderDataview: false,
	importNewPages: true,
	imageFolder: "images",
	maxImageWidth: 700,
	apiTokenSecretName: "",
	clientSecretSecretName: "",
	oauthMode: "service-account",
	oauthFlow: "authorization-code",
	oauthClientId: "",
	oauthClientSecretId: "",
	oauthCallbackUrl: "http://127.0.0.1:8766/callback",
	oauthSecretId: "",
	oauthSites: [],
	oauthSiteId: "",
} satisfies Partial<ObsidianPluginSettings>;

/** Merge persisted data over the defaults, keeping nested defaults for older settings files. */
export function mergeSettings(data: unknown): ObsidianPluginSettings {
	const loaded = (isRecord(data) ? data : {}) as Partial<ObsidianPluginSettings>;
	const settings: ObsidianPluginSettings = {
		...ConfluenceUploadSettings.DEFAULT_SETTINGS,
		...PLUGIN_DEFAULTS,
		...loaded,
		kroki: { ...DEFAULT_KROKI_SETTINGS, ...loaded.kroki },
		plantuml: {
			...ConfluenceUploadSettings.DEFAULT_SETTINGS.plantuml,
			...loaded.plantuml,
		},
	};
	if (!isMermaidTheme(settings.mermaidTheme)) settings.mermaidTheme = PLUGIN_DEFAULTS.mermaidTheme;
	return settings;
}

const SECRET_FIELDS = [
	{ value: "atlassianApiToken", name: "apiTokenSecretName", base: "confluence-api-token" },
	{
		value: "atlassianClientSecret",
		name: "clientSecretSecretName",
		base: "confluence-client-secret",
	},
] as const;

/**
 * Move credentials that older versions stored in plaintext data.json into SecretStorage.
 * Returns true when settings changed and must be saved.
 */
export function migrateSecretsToStorage(
	settings: ObsidianPluginSettings,
	storage: SecretStorage,
): boolean {
	let changed = false;
	for (const field of SECRET_FIELDS) {
		const legacyValue = settings[field.value];
		if (!legacyValue) continue;
		if (!settings[field.name]) settings[field.name] = uniqueSecretName(storage, field.base);
		if (!storage.getSecret(settings[field.name]))
			storage.setSecret(settings[field.name], legacyValue);
		settings[field.value] = "";
		changed = true;
	}
	return changed;
}

/** Settings with credential values read from SecretStorage. Never persist the result. */
export function withResolvedSecrets(
	settings: ObsidianPluginSettings,
	storage: SecretStorage,
): ObsidianPluginSettings {
	return {
		...settings,
		atlassianApiToken: readSecret(storage, settings.apiTokenSecretName),
		atlassianClientSecret: readSecret(storage, settings.clientSecretSecretName),
	};
}

/**
 * API tokens and bearer tokens use the site's own address as the API URL, so a blank
 * Confluence API URL falls back to the site URL. OAuth always needs the API gateway URL.
 */
export function withSiteUrlFallback<T extends ConfluenceUploadSettings.ConfluenceSettings>(
	settings: T,
): T {
	const siteUrl = settings.confluenceSiteUrl.trim();
	if (settings.confluenceBaseUrl.trim() || !siteUrl || settings.confluenceAuthType === "oauth2")
		return settings;
	return { ...settings, confluenceBaseUrl: siteUrl };
}

/** Browser sign-in: OAuth tokens from the plugin's own login instead of stored credentials. */
export function usesBrowserLogin(
	settings: Pick<ObsidianPluginSettings, "confluenceAuthType" | "oauthMode">,
): boolean {
	return settings.confluenceAuthType === "oauth2" && settings.oauthMode === "browser";
}

/** Browser sign-in reaches a site through Atlassian's API gateway, by the site's cloud ID. */
export function oauthApiUrl(siteId: string): string {
	return `https://api.atlassian.com/ex/confluence/${siteId}`;
}

/**
 * Settings to validate or authenticate with when an OAuth access token is used. The lib
 * treats the token as a bearer token, so the other credential fields aren't required.
 */
export function withBearerToken<T extends ConfluenceUploadSettings.ConfluenceSettings>(
	settings: T,
	token: string,
): T {
	return { ...settings, confluenceAuthType: "bearer", atlassianApiToken: token };
}

/** Setting names as the settings tab shows them, for validation messages. */
const SETTING_LABELS: Partial<Record<keyof ObsidianPluginSettings, string>> = {
	confluenceBaseUrl: "Confluence API URL",
	confluenceSiteUrl: "Confluence site URL",
	confluenceParentId: "Parent page ID",
	atlassianUserName: "Atlassian username",
	atlassianApiToken: "Atlassian API token",
	atlassianClientId: "OAuth client ID",
	atlassianClientSecret: "OAuth client secret",
	folderToPublish: "Folder to publish",
};

/** A validation issue from the lib, worded with the setting's name in the settings tab. */
export function describeSettingsIssue(issue: ConfluenceSettingsValidationIssue): string {
	const label = SETTING_LABELS[issue.field];
	if (!label) return issue.message;
	return / is required$/.test(issue.message)
		? `${label} is required.`
		: `${label}: ${issue.message}`;
}

/** The data written to data.json: credential values are always blank. */
export function toPersistedSettings(settings: ObsidianPluginSettings): ObsidianPluginSettings {
	return { ...settings, atlassianApiToken: "", atlassianClientSecret: "" };
}

function readSecret(storage: SecretStorage, name: string): string {
	return name ? (storage.getSecret(name) ?? "") : "";
}

function uniqueSecretName(storage: SecretStorage, base: string): string {
	const existing = new Set(storage.listSecrets());
	let name = base;
	for (let suffix = 2; existing.has(name); suffix++) name = `${base}-${suffix}`;
	return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
