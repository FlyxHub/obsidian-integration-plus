import {
	AbstractTextComponent,
	App,
	PluginSettingTab,
	SecretComponent,
	normalizePath,
	requireApiVersion,
	type SettingDefinitionItem,
} from "obsidian";
import { DEFAULT_KROKI_SETTINGS, validateConfluenceSettings } from "@markdown-confluence/lib";
import { browserLoginRows } from "./BrowserLoginSettings";
import type ConfluencePlugin from "./main";
import {
	MERMAID_THEMES,
	describeSettingsIssue,
	isMermaidTheme,
	usesBrowserLogin,
	withBearerToken,
	type ObsidianPluginSettings,
} from "./settings";
import {
	contentRow,
	renderSections,
	toDefinitions,
	type SettingRow,
	type SettingSection,
} from "./settingRows";

type SecretField = "apiTokenSecretName" | "clientSecretSecretName";

/** `SliderComponent` before Obsidian 1.13.0, where the tooltip showed the value. */
interface LegacySlider {
	setDynamicTooltip(): unknown;
}

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

	/** Obsidian 1.13.0 and later build the tab from these, and index them for search. */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		return toDefinitions(this.sections());
	}

	/** Obsidian versions before 1.13.0 render the tab here instead. */
	override display(): void {
		this.renderFallback();
	}

	private renderFallback() {
		this.containerEl.empty();
		renderSections(this.containerEl, this.sections());
	}

	/** Render the tab again after a change that adds or removes settings. */
	private redisplay() {
		if (requireApiVersion("1.13.0")) this.update();
		else this.renderFallback();
	}

	private sections(): SettingSection[] {
		return [
			{
				rows: [this.validationRow(), ...this.authenticationRows(), ...this.publishingRows()],
			},
			{ heading: "Diagrams", rows: this.mermaidRows() },
			{ heading: "Kroki", rows: this.krokiRows() },
			{ heading: "PlantUML", rows: this.plantumlRows() },
		];
	}

	/** Save the settings and refresh the list of problems at the top of the tab. */
	private async save() {
		await this.plugin.saveSettings();
		this.renderValidation();
	}

	private validationRow(): SettingRow {
		return contentRow("Settings problems", "confluence-settings-validation", (el) => {
			this.validationEl = el;
			this.renderValidation();
		});
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

	private authenticationRows(): SettingRow[] {
		const settings = this.settings;
		const oauth = settings.confluenceAuthType === "oauth2";
		const rows: SettingRow[] = [
			{
				name: "Authentication type",
				desc: "Sign in through your browser, or use an API token, personal access token or service account.",
				render: (setting) =>
					setting.addDropdown((dropdown) =>
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
								this.redisplay();
							}),
					),
			},
		];

		if (usesBrowserLogin(settings))
			return [...rows, ...browserLoginRows(this.plugin, () => this.redisplay())];

		rows.push(
			this.text(
				"Confluence site URL",
				"The address you open in a browser, for example https://example.atlassian.net.",
				() => settings.confluenceSiteUrl,
				(value) => (settings.confluenceSiteUrl = value.trim()),
			),
			this.text(
				"Confluence API URL",
				oauth
					? "Required for OAuth: https://api.atlassian.com/ex/confluence/{cloudId}"
					: "Optional. Leave empty to use the site URL. Scoped API tokens require https://api.atlassian.com/ex/confluence/{cloudId}.",
				() => settings.confluenceBaseUrl,
				(value) => (settings.confluenceBaseUrl = value.trim()),
			),
		);

		if (oauth) {
			rows.push(
				this.text(
					"OAuth client ID",
					"From the service account in Atlassian Administration.",
					() => settings.atlassianClientId,
					(value) => (settings.atlassianClientId = value.trim()),
				),
				this.secret(
					"OAuth client secret",
					"clientSecretSecretName",
					"Choose or create a secret in Obsidian secret storage. A fresh access token is requested for each publish.",
				),
			);
			return rows;
		}

		if (settings.confluenceAuthType === "basic")
			rows.push(
				this.text(
					"Atlassian username",
					"Your Atlassian account email address.",
					() => settings.atlassianUserName,
					(value) => (settings.atlassianUserName = value.trim()),
				),
			);
		rows.push(
			this.secret(
				"Atlassian API token",
				"apiTokenSecretName",
				"Choose or create a secret in Obsidian secret storage. The token is never written to plugin data.",
			),
		);
		return rows;
	}

	private publishingRows(): SettingRow[] {
		const settings = this.settings;
		return [
			this.text(
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
			),
			this.text(
				"Parent page ID",
				"The Confluence page that published notes are created under.",
				() => settings.confluenceParentId,
				(value) => (settings.confluenceParentId = value.trim()),
				{ placeholder: "23232345645" },
			),
			this.text(
				"Folder to publish",
				"Publish every note in this folder except notes with connie-publish: false.",
				() => settings.folderToPublish,
				(value) => (settings.folderToPublish = toVaultFolder(value)),
			),
			this.text(
				"Excluded folders",
				"One folder per line. Exclusions override publish tags and frontmatter.",
				() => (settings.foldersToExclude ?? []).join("\n"),
				(value) =>
					(settings.foldersToExclude = value.split("\n").map(toVaultFolder).filter(Boolean)),
				{ multiline: true },
			),
			this.text(
				"Tags to publish",
				"Also publish notes that have any of these tags. Separate tags with commas.",
				() => settings.tagsToPublish,
				(value) => (settings.tagsToPublish = value),
				{ placeholder: "docs, public" },
			),
			this.text(
				"Jira site URL",
				"Optional HTTPS Jira site used to turn issue keys into Jira smart links.",
				() => settings.jiraUrl ?? "",
				(value) => (settings.jiraUrl = value.trim()),
			),
			this.toggle(
				"Use first heading as page title",
				"The first heading replaces the file name as the page title.",
				() => settings.firstHeadingPageTitle,
				(value) => (settings.firstHeadingPageTitle = value),
			),
			this.toggle(
				"Apply page ordering",
				"Order published sibling pages by numeric sort-order frontmatter. Pages without it are left alone.",
				() => settings.orderPages ?? false,
				(value) => (settings.orderPages = value),
			),
			this.toggle(
				"Restrict editing to the publishing account",
				"Keep published pages readable but only editable by your publishing account. Override per note with connie-lock. Turning this off leaves existing restrictions in place; remove them in Confluence.",
				() => settings.lockPublishedPages ?? false,
				(value) => (settings.lockPublishedPages = value),
			),
			this.toggle(
				"Overwrite other users' edits",
				"Publish over pages that another user edited last. Their changes are lost.",
				() => settings.forceOverwrite,
				(value) => (settings.forceOverwrite = value),
			),
			this.toggle(
				"Show results after publishing",
				"Open a dialog with details when publishing finishes. When off, a short notice is shown instead.",
				() => settings.showPublishResultsModal,
				(value) => (settings.showPublishResultsModal = value),
			),
			this.toggle(
				"Publish Dataview results",
				"Publish Dataview TABLE, LIST and TASK queries as content. Requires Dataview in this vault. DataviewJS and inline queries are not supported.",
				() => settings.renderDataview,
				(value) => (settings.renderDataview = value),
			),
			this.toggle(
				"Import new pages when pulling",
				"When you pull all notes, create notes for pages that were added under the parent page in Confluence.",
				() => settings.importNewPages,
				(value) => (settings.importNewPages = value),
			),
			this.text(
				"Image folder",
				"Vault folder where pulling saves images and other attachments from Confluence.",
				() => settings.imageFolder,
				(value) => (settings.imageFolder = toVaultFolder(value)),
				{ placeholder: "images" },
			),
			this.text(
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
			),
		];
	}

	private mermaidRows(): SettingRow[] {
		const settings = this.settings;
		return [
			{
				name: "LaTeX equations",
				desc: "Inline $...$ and display $$...$$ equations are rendered on this computer as images when publishing. Your notes are not changed.",
				render: () => {},
			},
			{
				name: "Mermaid theme",
				desc: "The theme used when rendering Mermaid diagrams.",
				render: (setting) =>
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions(MERMAID_THEMES)
							.setValue(settings.mermaidTheme)
							.onChange(async (value) => {
								if (!isMermaidTheme(value)) return;
								settings.mermaidTheme = value;
								await this.save();
							}),
					),
			},
			this.formatDropdown(
				"Mermaid output format",
				() => settings.mermaid?.format ?? "png",
				(format) => (settings.mermaid = { ...settings.mermaid, format }),
			),
			{
				name: "Mermaid scale",
				desc: "PNG resolution multiplier, from 1 to 4.",
				render: (setting) =>
					setting.addSlider((slider) => {
						slider
							.setLimits(1, 4, 1)
							.setValue(settings.mermaid?.scale ?? 1)
							.onChange(async (value) => {
								settings.mermaid = { ...settings.mermaid, scale: value };
								await this.save();
							});
						// Obsidian 1.13.0 and later always show the value next to the slider and
						// deprecate the tooltip; earlier versions need it to show the value at all.
						if (!requireApiVersion("1.13.0"))
							(slider as unknown as LegacySlider).setDynamicTooltip();
					}),
			},
			this.text(
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
			),
		];
	}

	private krokiRows(): SettingRow[] {
		const kroki = (this.settings.kroki ??= { ...DEFAULT_KROKI_SETTINGS });
		return [
			this.toggle(
				"Enable Kroki rendering",
				"Render Kroki diagram code blocks. Turning this on sends their diagram source to the server below.",
				() => kroki.enabled,
				(value) => (kroki.enabled = value),
			),
			this.text(
				"Kroki server URL",
				"Use a server you trust, such as a self-hosted Kroki instance. Confluence credentials are never sent to it.",
				() => kroki.serverUrl,
				(value) => (kroki.serverUrl = value.trim()),
				{ placeholder: "https://kroki.io" },
			),
			this.formatDropdown(
				"Kroki output format",
				() => kroki.format,
				(format) => (kroki.format = format),
			),
		];
	}

	private plantumlRows(): SettingRow[] {
		const plantuml = this.settings.plantuml;
		return [
			this.toggle(
				"Enable PlantUML rendering",
				"Render PlantUML code blocks as images using the server below.",
				() => plantuml.enabled,
				(value) => (plantuml.enabled = value),
			),
			this.text(
				"PlantUML server URL",
				"Rendering sends diagram source to this server. Use a server you trust, such as a local PlantUML server container.",
				() => plantuml.serverUrl,
				(value) => (plantuml.serverUrl = value.trim()),
				{ placeholder: "http://localhost:8080" },
			),
		];
	}

	/**
	 * A text field saved on every change. `set` stores the value; it may return false to
	 * keep the last saved value while the input is invalid, such as half-typed JSON.
	 */
	private text(
		name: string,
		desc: string,
		get: () => string,
		set: (value: string) => unknown,
		{ placeholder, multiline }: TextOptions = {},
	): SettingRow {
		const onChange = async (value: string) => {
			if (set(value) === false) return;
			await this.save();
		};
		const configure = (text: AbstractTextComponent<HTMLInputElement | HTMLTextAreaElement>) => {
			if (placeholder) text.setPlaceholder(placeholder);
			text.setValue(get()).onChange(onChange);
		};
		return {
			name,
			desc,
			render: (setting) => {
				if (multiline) setting.addTextArea(configure);
				else setting.addText(configure);
			},
		};
	}

	private secret(name: string, field: SecretField, desc: string): SettingRow {
		return {
			name,
			desc,
			render: (setting) =>
				setting.addComponent((el) =>
					new SecretComponent(this.app, el)
						.setValue(this.settings[field])
						.onChange(async (value) => {
							this.settings[field] = value;
							await this.save();
						}),
				),
		};
	}

	private toggle(
		name: string,
		desc: string,
		get: () => boolean,
		set: (value: boolean) => void,
	): SettingRow {
		return {
			name,
			desc,
			render: (setting) =>
				setting.addToggle((toggle) =>
					toggle.setValue(get()).onChange(async (value) => {
						set(value);
						await this.save();
					}),
				),
		};
	}

	/** The PNG or SVG choice that Mermaid and Kroki both offer. */
	private formatDropdown(
		name: string,
		get: () => "png" | "svg",
		set: (format: "png" | "svg") => void,
	): SettingRow {
		return {
			name,
			render: (setting) =>
				setting.addDropdown((dropdown) =>
					dropdown
						.addOptions({ png: "PNG", svg: "SVG" })
						.setValue(get())
						.onChange(async (value) => {
							if (value !== "png" && value !== "svg") return;
							set(value);
							await this.save();
						}),
				),
		};
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
