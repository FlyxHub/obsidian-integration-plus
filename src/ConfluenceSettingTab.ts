import { App, Notice, PluginSettingTab, SecretComponent, Setting, normalizePath } from "obsidian";
import { DEFAULT_KROKI_SETTINGS, validateConfluenceSettings } from "@markdown-confluence/lib";
import type ConfluencePlugin from "./main";
import {
	MERMAID_THEMES,
	describeSettingsIssue,
	isMermaidTheme,
	type ObsidianPluginSettings,
} from "./settings";

type TextField =
	"confluenceBaseUrl" | "confluenceSiteUrl" | "atlassianUserName" | "atlassianClientId";
type SecretField = "apiTokenSecretName" | "clientSecretSecretName";

export class ConfluenceSettingTab extends PluginSettingTab {
	plugin: ConfluencePlugin;

	constructor(app: App, plugin: ConfluencePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private get settings(): ObsidianPluginSettings {
		return this.plugin.settings;
	}

	private get usesBrowserLogin(): boolean {
		return this.settings.confluenceAuthType === "oauth2" && this.settings.oauthMode === "browser";
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const validationEl = containerEl.createDiv({ cls: "confluence-settings-validation" });
		const renderValidation = () => this.renderValidation(validationEl);
		const save = async () => {
			await this.plugin.saveSettings();
			renderValidation();
		};
		renderValidation();

		this.renderAuthentication(containerEl, save);
		this.renderPublishing(containerEl, save);
		this.renderMermaid(containerEl);
		this.renderKroki(containerEl);
		this.renderPlantuml(containerEl);
	}

	private renderValidation(containerEl: HTMLElement) {
		containerEl.empty();
		const settings = this.plugin.resolvedSettings();
		const result = validateConfluenceSettings(
			this.usesBrowserLogin
				? { ...settings, confluenceAuthType: "bearer", atlassianApiToken: "browser-session" }
				: settings,
		);
		if (this.usesBrowserLogin && !this.plugin.browserOAuth.connected)
			containerEl.createEl("p", { text: "Connect to Atlassian before publishing." });
		if (result.valid) return;

		containerEl.createEl("p", { text: "Fix these settings before publishing:" });
		const list = containerEl.createEl("ul");
		for (const issue of result.issues) list.createEl("li", { text: describeSettingsIssue(issue) });
	}

	private renderAuthentication(containerEl: HTMLElement, save: () => Promise<void>) {
		const oauth = this.settings.confluenceAuthType === "oauth2";
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
					.setValue(this.usesBrowserLogin ? "browser" : this.settings.confluenceAuthType)
					.onChange(async (value) => {
						if (value !== "browser" && !isConfluenceAuthType(value)) return;
						this.plugin.browserOAuth.cancel();
						this.settings.oauthMode = value === "browser" ? "browser" : "service-account";
						this.settings.confluenceAuthType = value === "browser" ? "oauth2" : value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.usesBrowserLogin) {
			this.renderBrowserLogin(containerEl);
			return;
		}

		this.addText(
			containerEl,
			save,
			"Confluence site URL",
			"confluenceSiteUrl",
			"The address you open in a browser, for example https://example.atlassian.net.",
		);
		this.addText(
			containerEl,
			save,
			"Confluence API URL",
			"confluenceBaseUrl",
			oauth
				? "Required for OAuth: https://api.atlassian.com/ex/confluence/{cloudId}"
				: "Optional. Leave empty to use the site URL. Scoped API tokens require https://api.atlassian.com/ex/confluence/{cloudId}.",
		);

		if (oauth) {
			this.addText(
				containerEl,
				save,
				"OAuth client ID",
				"atlassianClientId",
				"From the service account in Atlassian Administration.",
			);
			this.addSecret(
				containerEl,
				save,
				"OAuth client secret",
				"clientSecretSecretName",
				"Choose or create a secret in Obsidian secret storage. A fresh access token is requested for each publish.",
			);
			return;
		}

		if (this.settings.confluenceAuthType === "basic")
			this.addText(
				containerEl,
				save,
				"Atlassian username",
				"atlassianUserName",
				"Your Atlassian account email address.",
			);
		this.addSecret(
			containerEl,
			save,
			"Atlassian API token",
			"apiTokenSecretName",
			"Choose or create a secret in Obsidian secret storage. The token is never written to plugin data.",
		);
	}

	private renderBrowserLogin(containerEl: HTMLElement) {
		const auth = this.plugin.browserOAuth;
		const disabled = auth.pending || auth.connected;

		new Setting(containerEl)
			.setName("Login method")
			.setDesc(
				"Login runs inside this plugin. Device code login requires Atlassian to enable the grant for your app.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ "authorization-code": "Browser login", device: "Device code" })
					.setValue(this.settings.oauthFlow)
					.setDisabled(disabled)
					.onChange(async (value) => {
						if (value !== "authorization-code" && value !== "device") return;
						this.settings.oauthFlow = value;
						auth.status = "";
						await this.plugin.saveSettings();
						this.display();
					}),
			);
		new Setting(containerEl)
			.setName("OAuth client ID")
			.setDesc("The app registered with Atlassian for this integration.")
			.addText((text) =>
				text
					.setValue(this.settings.oauthClientId)
					.setDisabled(disabled)
					.onChange(async (value) => {
						this.settings.oauthClientId = value.trim();
						auth.status = "";
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("OAuth client secret")
			.setDesc(
				"Saved in Obsidian secret storage. Standard Atlassian browser apps require it; leave it empty only for an approved public client.",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(auth.hasClientSecret ? "Secret saved" : "Enter app secret if required")
					.setDisabled(disabled)
					.onChange(async (value) => {
						try {
							await auth.saveClientSecret(value);
						} catch (error) {
							new Notice(error instanceof Error ? error.message : "Could not save secret");
						}
					});
			})
			.addButton((button) =>
				button
					.setButtonText("Clear secret")
					.setDisabled(disabled || !auth.hasClientSecret)
					.onClick(async () => {
						await auth.saveClientSecret("");
						this.display();
					}),
			);
		if (this.settings.oauthFlow === "authorization-code")
			new Setting(containerEl)
				.setName("Callback URL")
				.setDesc(
					"Register this exact URL with Atlassian. Obsidian listens on this computer only while you sign in.",
				)
				.addText((text) =>
					text
						.setValue(this.settings.oauthCallbackUrl)
						.setDisabled(disabled)
						.onChange(async (value) => {
							this.settings.oauthCallbackUrl = value.trim();
							await this.plugin.saveSettings();
						}),
				);
		if (auth.deviceAuthorization) {
			new Setting(containerEl)
				.setName("Your device code")
				.setDesc(auth.deviceAuthorization.userCode)
				.addButton((button) =>
					button.setButtonText("Copy code").onClick(async () => {
						if (auth.deviceAuthorization)
							await navigator.clipboard.writeText(auth.deviceAuthorization.userCode);
					}),
				);
		}

		const status = new Setting(containerEl)
			.setName("Atlassian connection")
			.setDesc(
				auth.status ||
					(auth.connected
						? "Connected"
						: "Sign in to choose the Confluence site this vault can publish to."),
			);
		if (auth.pending) {
			status.addButton((button) =>
				button.setButtonText("Open browser").onClick(() => auth.openBrowser()),
			);
			status.addButton((button) =>
				button.setButtonText("Cancel login").onClick(() => auth.cancel()),
			);
		} else {
			status.addButton((button) =>
				button
					.setButtonText(auth.connected ? "Reconnect" : "Connect to Atlassian")
					.setCta()
					.onClick(async () => {
						try {
							await auth.connect(() => this.display());
							await this.plugin.selectOAuthSite(this.settings.oauthSiteId);
							new Notice("Connected to Atlassian");
						} catch (error) {
							new Notice(error instanceof Error ? error.message : "Login failed");
						}
						this.display();
					}),
			);
		}
		if (!auth.connected || auth.pending) return;

		status.addButton((button) =>
			button.setButtonText("Disconnect").onClick(async () => {
				await auth.disconnect();
				this.display();
			}),
		);
		new Setting(containerEl)
			.setName("Confluence site")
			.setDesc("Only sites you approved during login are available.")
			.addDropdown((dropdown) => {
				for (const site of this.settings.oauthSites)
					dropdown.addOption(site.id, new URL(site.url).hostname);
				dropdown.setValue(this.settings.oauthSiteId).onChange(async (value) => {
					await this.plugin.selectOAuthSite(value);
					this.display();
				});
			});
		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Check access to the parent page without publishing.")
			.addButton((button) =>
				button.setButtonText("Test connection").onClick(async () => {
					button.setDisabled(true);
					try {
						const client = await this.plugin.authenticationClient();
						const page = await client.content.getContentById({
							id: this.settings.confluenceParentId,
						});
						auth.status = `Connected · Parent page: ${page.title}`;
					} catch {
						auth.status = "Could not access the parent page. Check its ID, site and permissions.";
					}
					new Notice(auth.status);
					this.display();
				}),
			);
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Tokens are kept in Obsidian secret storage. Disconnect removes this vault's saved login. You can revoke the app under connected apps in your Atlassian account.",
		});
	}

	private renderPublishing(containerEl: HTMLElement, save: () => Promise<void>) {
		new Setting(containerEl)
			.setName("Custom request headers")
			.setDesc(
				'JSON object, for example {"X-Custom-Header":"value"}. Stored in plain text in plugin data, so do not put credentials here.',
			)
			.addTextArea((text) =>
				text
					.setPlaceholder('{"X-Custom-Header":"value"}')
					.setValue(formatRequestHeaders(this.settings.confluenceRequestHeaders))
					.onChange(async (value) => {
						const headers = parseRequestHeaders(value);
						if (!headers) return;
						this.settings.confluenceRequestHeaders = headers;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Parent page ID")
			.setDesc("The Confluence page that published notes are created under.")
			.addText((text) =>
				text
					.setPlaceholder("23232345645")
					.setValue(this.settings.confluenceParentId)
					.onChange(async (value) => {
						this.settings.confluenceParentId = value.trim();
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Folder to publish")
			.setDesc("Publish every note in this folder except notes with connie-publish: false.")
			.addText((text) =>
				text.setValue(this.settings.folderToPublish).onChange(async (value) => {
					this.settings.folderToPublish = toVaultFolder(value);
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("One folder per line. Exclusions override publish tags and frontmatter.")
			.addTextArea((text) =>
				text.setValue((this.settings.foldersToExclude ?? []).join("\n")).onChange(async (value) => {
					this.settings.foldersToExclude = value.split("\n").map(toVaultFolder).filter(Boolean);
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Tags to publish")
			.setDesc("Also publish notes that have any of these tags. Separate tags with commas.")
			.addText((text) =>
				text
					.setPlaceholder("docs, public")
					.setValue(this.settings.tagsToPublish)
					.onChange(async (value) => {
						this.settings.tagsToPublish = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Jira site URL")
			.setDesc("Optional HTTPS Jira site used to turn issue keys into Jira smart links.")
			.addText((text) =>
				text.setValue(this.settings.jiraUrl ?? "").onChange(async (value) => {
					this.settings.jiraUrl = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		this.addToggle(
			containerEl,
			"Use first heading as page title",
			"The first heading replaces the file name as the page title.",
			() => this.settings.firstHeadingPageTitle,
			(value) => (this.settings.firstHeadingPageTitle = value),
		);
		this.addToggle(
			containerEl,
			"Apply page ordering",
			"Order published sibling pages by numeric sort-order frontmatter. Pages without it are left alone.",
			() => this.settings.orderPages ?? false,
			(value) => (this.settings.orderPages = value),
		);
		this.addToggle(
			containerEl,
			"Restrict editing to the publishing account",
			"Keep published pages readable but only editable by your publishing account. Override per note with connie-lock. Turning this off leaves existing restrictions in place; remove them in Confluence.",
			() => this.settings.lockPublishedPages ?? false,
			(value) => (this.settings.lockPublishedPages = value),
		);
		this.addToggle(
			containerEl,
			"Overwrite other users' edits",
			"Publish over pages that another user edited last. Their changes are lost.",
			() => this.settings.forceOverwrite,
			(value) => (this.settings.forceOverwrite = value),
		);
		this.addToggle(
			containerEl,
			"Show results after publishing",
			"Open a dialog with details when publishing finishes. When off, a short notice is shown instead.",
			() => this.settings.showPublishResultsModal,
			(value) => (this.settings.showPublishResultsModal = value),
		);
		this.addToggle(
			containerEl,
			"Publish Dataview results",
			"Publish Dataview TABLE, LIST and TASK queries as content. Requires Dataview in this vault. DataviewJS and inline queries are not supported.",
			() => this.settings.renderDataview,
			(value) => (this.settings.renderDataview = value),
		);
		this.addToggle(
			containerEl,
			"Import new pages when pulling",
			"When you pull all notes, create notes for pages that were added under the parent page in Confluence.",
			() => this.settings.importNewPages,
			(value) => (this.settings.importNewPages = value),
		);
		new Setting(containerEl)
			.setName("Image folder")
			.setDesc("Vault folder where pulling saves images and other attachments from Confluence.")
			.addText((text) =>
				text
					.setPlaceholder("images")
					.setValue(this.settings.imageFolder)
					.onChange(async (value) => {
						this.settings.imageFolder = toVaultFolder(value);
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderMermaid(containerEl: HTMLElement) {
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
					.setValue(this.settings.mermaidTheme)
					.onChange(async (value) => {
						if (!isMermaidTheme(value)) return;
						this.settings.mermaidTheme = value;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl).setName("Mermaid output format").addDropdown((dropdown) =>
			dropdown
				.addOptions({ png: "PNG", svg: "SVG" })
				.setValue(this.settings.mermaid?.format ?? "png")
				.onChange(async (value) => {
					if (value !== "png" && value !== "svg") return;
					this.settings.mermaid = { ...this.settings.mermaid, format: value };
					await this.plugin.saveSettings();
				}),
		);
		new Setting(containerEl)
			.setName("Mermaid scale")
			.setDesc("PNG resolution multiplier, from 1 to 4.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 4, 1)
					.setValue(this.settings.mermaid?.scale ?? 1)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.settings.mermaid = { ...this.settings.mermaid, scale: value };
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Mermaid theme variables")
			.setDesc("Optional JSON object of Mermaid color variables. Invalid JSON is not saved.")
			.addTextArea((text) =>
				text
					.setValue(JSON.stringify(this.settings.mermaid?.themeVariables ?? {}, null, 2))
					.onChange(async (value) => {
						const variables = parseStringRecord(value);
						if (!variables) return;
						this.settings.mermaid = { ...this.settings.mermaid, themeVariables: variables };
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderKroki(containerEl: HTMLElement) {
		const kroki = (this.settings.kroki ??= { ...DEFAULT_KROKI_SETTINGS });
		new Setting(containerEl).setName("Kroki").setHeading();
		new Setting(containerEl)
			.setName("Enable Kroki rendering")
			.setDesc(
				"Render Kroki diagram code blocks. Turning this on sends their diagram source to the server below.",
			)
			.addToggle((toggle) =>
				toggle.setValue(kroki.enabled).onChange(async (value) => {
					kroki.enabled = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Kroki server URL")
			.setDesc(
				"Use a server you trust, such as a self-hosted Kroki instance. Confluence credentials are never sent to it.",
			)
			.addText((text) =>
				text
					.setPlaceholder("https://kroki.io")
					.setValue(kroki.serverUrl)
					.onChange(async (value) => {
						kroki.serverUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl).setName("Kroki output format").addDropdown((dropdown) =>
			dropdown
				.addOptions({ png: "PNG", svg: "SVG" })
				.setValue(kroki.format)
				.onChange(async (value) => {
					if (value !== "png" && value !== "svg") return;
					kroki.format = value;
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderPlantuml(containerEl: HTMLElement) {
		const plantuml = this.settings.plantuml;
		new Setting(containerEl).setName("PlantUML").setHeading();
		new Setting(containerEl)
			.setName("Enable PlantUML rendering")
			.setDesc("Render PlantUML code blocks as images using the server below.")
			.addToggle((toggle) =>
				toggle.setValue(plantuml.enabled).onChange(async (value) => {
					plantuml.enabled = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("PlantUML server URL")
			.setDesc(
				"Rendering sends diagram source to this server. Use a server you trust, such as a local PlantUML server container.",
			)
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:8080")
					.setValue(plantuml.serverUrl)
					.onChange(async (value) => {
						plantuml.serverUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}

	private addText(
		containerEl: HTMLElement,
		save: () => Promise<void>,
		name: string,
		field: TextField,
		description: string,
	) {
		new Setting(containerEl)
			.setName(name)
			.setDesc(description)
			.addText((text) =>
				text.setValue(this.settings[field]).onChange(async (value) => {
					this.settings[field] = value.trim();
					await save();
				}),
			);
	}

	private addSecret(
		containerEl: HTMLElement,
		save: () => Promise<void>,
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
					await save();
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
					await this.plugin.saveSettings();
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
