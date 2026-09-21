import type { SecretStorage } from "obsidian";
import { ConfluenceUploadSettings, DEFAULT_KROKI_SETTINGS } from "@markdown-confluence/lib";
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
