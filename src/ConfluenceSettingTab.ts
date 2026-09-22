import {
	AbstractTextComponent,
	App,
	PluginSettingTab,
	SecretComponent,
	Setting,
	normalizePath,
} from "obsidian";
import { DEFAULT_KROKI_SETTINGS, validateConfluenceSettings } from "@markdown-confluence/lib";
import { renderBrowserLogin } from "./BrowserLoginSettings";
import type ConfluencePlugin from "./main";
import {
	MERMAID_THEMES,
	describeSettingsIssue,
	isMermaidTheme,
	usesBrowserLogin,
	withBearerToken,
	type ObsidianPluginSettings,
} from "./settings";

type SecretField = "apiTokenSecretName" | "clientSecretSecretName";

interface TextOptions {
	placeholder?: string;
	multiline?: boolean;
}

export class ConfluenceSettingTab extends PluginSettingTab {
	plugin: ConfluencePlugin;
	private validationEl: HTMLElement | undefined;

	constructor(app: App, plugin: ConfluencePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private get settings(): ObsidianPluginSettings {
		return this.plugin.settings;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.validationEl = containerEl.createDiv({ cls: "confluence-settings-validation" });
		this.renderValidation();

		this.renderAuthentication(containerEl);
		this.renderPublishing(containerEl);
		this.renderMermaid(containerEl);
		this.renderKroki(containerEl);
		this.renderPlantuml(containerEl);
	}

	/** Save the settings and refresh the list of problems at the top of the tab. */
	private async save() {
		await this.plugin.saveSettings();
		this.renderValidation();
	}

	private renderValidation() {
		const containerEl = this.validationEl;
		if (!containerEl) return;
		containerEl.empty();
		const settings = this.plugin.resolvedSettings();
		const browserLogin = usesBrowserLogin(settings);
		const result = validateConfluenceSettings(
			browserLogin ? withBearerToken(settings, "browser-session") : settings,
		);
		if (browserLogin && !this.plugin.browserOAuth.connected)
			containerEl.createEl("p", { text: "Connect to Atlassian before publishing." });
		if (result.valid) return;

		containerEl.createEl("p", { text: "Fix these settings before publishing:" });
		const list = containerEl.createEl("ul");
		for (const issue of result.issues) list.createEl("li", { text: describeSettingsIssue(issue) });
	}

	private renderAuthentication(containerEl: HTMLElement) {
		const settings = this.settings;
		const oauth = settings.confluenceAuthType === "oauth2";
		new Setting(containerEl)
			.setName("Authentication type")
			.setDesc(
				"Sign in through your browser, or use an API token, personal access token or service account.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						basic: "API token (basic)",
						bearer: "Bearer token or PAT",
						oauth2: "OAuth service account",
						browser: "OAuth browser sign-in",
					})
					.setValue(usesBrowserLogin(settings) ? "browser" : settings.confluenceAuthType)
					.onChange(async (value) => {
						if (value !== "browser" && !isConfluenceAuthType(value)) return;
						this.plugin.browserOAuth.cancel();
						settings.oauthMode = value === "browser" ? "browser" : "service-account";
						settings.confluenceAuthType = value === "browser" ? "oauth2" : value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (usesBrowserLogin(settings)) {
			renderBrowserLogin(containerEl, this.plugin, () => this.display());
			return;
		}

		this.addText(
			containerEl,
			"Confluence site URL",
			"The address you open in a browser, for example https://example.atlassian.net.",
			() => settings.confluenceSiteUrl,
			(value) => (settings.confluenceSiteUrl = value.trim()),
		);
		this.addText(
			containerEl,
			"Confluence API URL",
			oauth
				? "Required for OAuth: https://api.atlassian.com/ex/confluence/{cloudId}"
				: "Optional. Leave empty to use the site URL. Scoped API tokens require https://api.atlassian.com/ex/confluence/{cloudId}.",
			() => settings.confluenceBaseUrl,
			(value) => (settings.confluenceBaseUrl = value.trim()),
		);

		if (oauth) {
			this.addText(
				containerEl,
				"OAuth client ID",
				"From the service account in Atlassian Administration.",
				() => settings.atlassianClientId,
				(value) => (settings.atlassianClientId = value.trim()),
			);
			this.addSecret(
				containerEl,
				"OAuth client secret",
				"clientSecretSecretName",
				"Choose or create a secret in Obsidian secret storage. A fresh access token is requested for each publish.",
			);
			return;
		}

		if (settings.confluenceAuthType === "basic")
			this.addText(
				containerEl,
				"Atlassian username",
				"Your Atlassian account email address.",
				() => settings.atlassianUserName,
				(value) => (settings.atlassianUserName = value.trim()),
			);
		this.addSecret(
			containerEl,
			"Atlassian API token",
			"apiTokenSecretName",
			"Choose or create a secret in Obsidian secret storage. The token is never written to plugin data.",
		);
	}

	private renderPublishing(containerEl: HTMLElement) {
		const settings = this.settings;
		this.addText(
			containerEl,
			"Custom request headers",
			'JSON object, for example {"X-Custom-Header":"value"}. Stored in plain text in plugin data, so do not put credentials here.',
			() => formatRequestHeaders(settings.confluenceRequestHeaders),
			(value) => {
				const headers = parseRequestHeaders(value);
				if (!headers) return false;
				settings.confluenceRequestHeaders = headers;
				return true;
			},
			{ placeholder: '{"X-Custom-Header":"value"}', multiline: true },
		);
		this.addText(
			containerEl,
			"Parent page ID",
			"The Confluence page that published notes are created under.",
			() => settings.confluenceParentId,
			(value) => (settings.confluenceParentId = value.trim()),
			{ placeholder: "23232345645" },
		);
		this.addText(
			containerEl,
			"Folder to publish",
			"Publish every note in this folder except notes with connie-publish: false.",
			() => settings.folderToPublish,
			(value) => (settings.folderToPublish = toVaultFolder(value)),
		);
		this.addText(
			containerEl,
			"Excluded folders",
			"One folder per line. Exclusions override publish tags and frontmatter.",
			() => (settings.foldersToExclude ?? []).join("\n"),
			(value) => (settings.foldersToExclude = value.split("\n").map(toVaultFolder).filter(Boolean)),
			{ multiline: true },
		);
		this.addText(
			containerEl,
			"Tags to publish",
			"Also publish notes that have any of these tags. Separate tags with commas.",
			() => settings.tagsToPublish,
			(value) => (settings.tagsToPublish = value),
			{ placeholder: "docs, public" },
		);
		this.addText(
			containerEl,
			"Jira site URL",
			"Optional HTTPS Jira site used to turn issue keys into Jira smart links.",
			() => settings.jiraUrl ?? "",
			(value) => (settings.jiraUrl = value.trim()),
		);

		this.addToggle(
			containerEl,
			"Use first heading as page title",
			"The first heading replaces the file name as the page title.",
			() => settings.firstHeadingPageTitle,
			(value) => (settings.firstHeadingPageTitle = value),
		);
		this.addToggle(
			containerEl,
			"Apply page ordering",
			"Order published sibling pages by numeric sort-order frontmatter. Pages without it are left alone.",
			() => settings.orderPages ?? false,
			(value) => (settings.orderPages = value),
		);
		this.addToggle(
			containerEl,
			"Restrict editing to the publishing account",
			"Keep published pages readable but only editable by your publishing account. Override per note with connie-lock. Turning this off leaves existing restrictions in place; remove them in Confluence.",
			() => settings.lockPublishedPages ?? false,
			(value) => (settings.lockPublishedPages = value),
		);
		this.addToggle(
			containerEl,
			"Overwrite other users' edits",
			"Publish over pages that another user edited last. Their changes are lost.",
			() => settings.forceOverwrite,
			(value) => (settings.forceOverwrite = value),
		);
		this.addToggle(
			containerEl,
			"Show results after publishing",
			"Open a dialog with details when publishing finishes. When off, a short notice is shown instead.",
			() => settings.showPublishResultsModal,
			(value) => (settings.showPublishResultsModal = value),
		);
		this.addToggle(
			containerEl,
			"Publish Dataview results",
			"Publish Dataview TABLE, LIST and TASK queries as content. Requires Dataview in this vault. DataviewJS and inline queries are not supported.",
			() => settings.renderDataview,
			(value) => (settings.renderDataview = value),
		);
		this.addToggle(
			containerEl,
			"Import new pages when pulling",
			"When you pull all notes, create notes for pages that were added under the parent page in Confluence.",
			() => settings.importNewPages,
			(value) => (settings.importNewPages = value),
		);
		this.addText(
			containerEl,
			"Image folder",
			"Vault folder where pulling saves images and other attachments from Confluence.",
			() => settings.imageFolder,
			(value) => (settings.imageFolder = toVaultFolder(value)),
			{ placeholder: "images" },
		);
		this.addText(
			containerEl,
			"Maximum image width",
			"Published images wider than this many pixels are scaled down to it, close to how Obsidian shows them. To size one image, add a width to its embed, such as ![[image.png|400]]. Enter 0 for no limit.",
			() => String(settings.maxImageWidth),
			(value) => {
				const width = Number(value.trim() || "0");
				if (!Number.isInteger(width) || width < 0) return false;
				settings.maxImageWidth = width;
				return true;
			},
			{ placeholder: "700" },
		);
	}

	private renderMermaid(containerEl: HTMLElement) {
		const settings = this.settings;
		new Setting(containerEl).setName("Diagrams").setHeading();
		new Setting(containerEl)
			.setName("LaTeX equations")
			.setDesc(
				"Inline $...$ and display $$...$$ equations are rendered on this computer as images when publishing. Your notes are not changed.",
			);

		new Setting(containerEl)
			.setName("Mermaid theme")
			.setDesc("The theme used when rendering Mermaid diagrams.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(MERMAID_THEMES)
					.setValue(settings.mermaidTheme)
					.onChange(async (value) => {
						if (!isMermaidTheme(value)) return;
						settings.mermaidTheme = value;
						await this.save();
					}),
			);
		this.addFormatDropdown(
			containerEl,
			"Mermaid output format",
			() => settings.mermaid?.format ?? "png",
			(format) => (settings.mermaid = { ...settings.mermaid, format }),
		);
		new Setting(containerEl)
			.setName("Mermaid scale")
			.setDesc("PNG resolution multiplier, from 1 to 4.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 4, 1)
					.setValue(settings.mermaid?.scale ?? 1)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.mermaid = { ...settings.mermaid, scale: value };
						await this.save();
					}),
			);
		this.addText(
			containerEl,
			"Mermaid theme variables",
			"Optional JSON object of Mermaid color variables. Invalid JSON is not saved.",
			() => JSON.stringify(settings.mermaid?.themeVariables ?? {}, null, 2),
			(value) => {
				const variables = parseStringRecord(value);
				if (!variables) return false;
				settings.mermaid = { ...settings.mermaid, themeVariables: variables };
				return true;
			},
			{ multiline: true },
		);
	}

	private renderKroki(containerEl: HTMLElement) {
		const kroki = (this.settings.kroki ??= { ...DEFAULT_KROKI_SETTINGS });
		new Setting(containerEl).setName("Kroki").setHeading();
		this.addToggle(
			containerEl,
			"Enable Kroki rendering",
			"Render Kroki diagram code blocks. Turning this on sends their diagram source to the server below.",
			() => kroki.enabled,
			(value) => (kroki.enabled = value),
		);
		this.addText(
			containerEl,
			"Kroki server URL",
			"Use a server you trust, such as a self-hosted Kroki instance. Confluence credentials are never sent to it.",
			() => kroki.serverUrl,
			(value) => (kroki.serverUrl = value.trim()),
			{ placeholder: "https://kroki.io" },
		);
		this.addFormatDropdown(
			containerEl,
			"Kroki output format",
			() => kroki.format,
			(format) => (kroki.format = format),
		);
	}

	private renderPlantuml(containerEl: HTMLElement) {
		const plantuml = this.settings.plantuml;
		new Setting(containerEl).setName("PlantUML").setHeading();
		this.addToggle(
			containerEl,
			"Enable PlantUML rendering",
			"Render PlantUML code blocks as images using the server below.",
			() => plantuml.enabled,
			(value) => (plantuml.enabled = value),
		);
		this.addText(
			containerEl,
			"PlantUML server URL",
			"Rendering sends diagram source to this server. Use a server you trust, such as a local PlantUML server container.",
			() => plantuml.serverUrl,
			(value) => (plantuml.serverUrl = value.trim()),
			{ placeholder: "http://localhost:8080" },
		);
	}

	/**
	 * A text field saved on every change. `set` stores the value; it may return false to
	 * keep the last saved value while the input is invalid, such as half-typed JSON.
	 */
	private addText(
		containerEl: HTMLElement,
		name: string,
		description: string,
		get: () => string,
		set: (value: string) => unknown,
		{ placeholder, multiline }: TextOptions = {},
	) {
		const setting = new Setting(containerEl).setName(name).setDesc(description);
		const onChange = async (value: string) => {
			if (set(value) === false) return;
			await this.save();
		};
		const configure = (text: AbstractTextComponent<HTMLInputElement | HTMLTextAreaElement>) => {
			if (placeholder) text.setPlaceholder(placeholder);
			text.setValue(get()).onChange(onChange);
		};
		if (multiline) setting.addTextArea(configure);
		else setting.addText(configure);
	}

	private addSecret(
		containerEl: HTMLElement,
		name: string,
		field: SecretField,
		description: string,
	) {
		new Setting(containerEl)
			.setName(name)
			.setDesc(description)
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(this.settings[field]).onChange(async (value) => {
					this.settings[field] = value;
					await this.save();
				}),
			);
	}

	private addToggle(
		containerEl: HTMLElement,
		name: string,
		description: string,
		get: () => boolean,
		set: (value: boolean) => void,
	) {
		new Setting(containerEl)
			.setName(name)
			.setDesc(description)
			.addToggle((toggle) =>
				toggle.setValue(get()).onChange(async (value) => {
					set(value);
					await this.save();
				}),
			);
	}

	/** The PNG or SVG choice that Mermaid and Kroki both offer. */
	private addFormatDropdown(
		containerEl: HTMLElement,
		name: string,
		get: () => "png" | "svg",
		set: (format: "png" | "svg") => void,
	) {
		new Setting(containerEl).setName(name).addDropdown((dropdown) =>
			dropdown
				.addOptions({ png: "PNG", svg: "SVG" })
				.setValue(get())
				.onChange(async (value) => {
					if (value !== "png" && value !== "svg") return;
					set(value);
					await this.save();
				}),
		);
	}
}

function isConfluenceAuthType(value: string): value is "basic" | "bearer" | "oauth2" {
	return value === "basic" || value === "bearer" || value === "oauth2";
}

/** Vault-relative folder path; normalizePath("") would return "/", so keep blanks blank. */
function toVaultFolder(value: string): string {
	const trimmed = value.trim();
	return trimmed ? normalizePath(trimmed) : "";
}

function formatRequestHeaders(headers: Record<string, string>): string {
	return Object.keys(headers).length === 0 ? "" : JSON.stringify(headers, null, 2);
}

function parseRequestHeaders(value: string): Record<string, string> | undefined {
	return value.trim() ? parseStringRecord(value) : {};
}

/** Parse a JSON object whose values are all strings; undefined while the input is invalid. */
function parseStringRecord(value: string): Record<string, string> | undefined {
	try {
		const parsed: unknown = JSON.parse(value.trim() || "{}");
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			Object.values(parsed).every((entry) => typeof entry === "string")
		)
			return parsed as Record<string, string>;
	} catch {
		// Keep the last valid value while the user is still typing.
	}
	return undefined;
}
