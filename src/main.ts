import {
	FrontMatterCache,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	Vault,
	loadMermaid,
	normalizePath,
} from "obsidian";
import {
	ADFProcessingPlugin,
	ConfluencePageConfig,
	ConfluenceUploadSettings,
	HttpKrokiRenderer,
	KrokiRendererPlugin,
	MarkdownConfluencePlatform,
	MarkdownSourceTransformerService,
	MarkdownWorkspaceLive,
	MarkdownWorkspaceService,
	MathRendererPlugin,
	MermaidRendererPlugin,
	PlantumlRendererPlugin,
	Publisher,
	shouldPublishMarkdownFile,
} from "@markdown-confluence/lib";
import { Effect, Layer } from "effect";
import {
	ElectronMathRenderer,
	ElectronMermaidRenderer,
} from "@markdown-confluence/mermaid-electron-renderer";
import { HttpPlantumlRenderer } from "@markdown-confluence/plantuml-renderer";
import type { MermaidConfig } from "mermaid";
import { BrowserOAuth } from "./BrowserOAuth";
import { CompletedModal, type UploadResults } from "./CompletedModal";
import {
	ConfluencePerPageForm,
	mapFrontmatterToConfluencePerPageUIValues,
} from "./ConfluencePerPageForm";
import { ConfluenceSettingTab } from "./ConfluenceSettingTab";
import { createDataviewTransformer } from "./DataviewTransformer";
import { krokiFetch } from "./KrokiFetch";
import { createObsidianConfluenceClient } from "./ObsidianAuthentication";
import { ObsidianPlatformLive } from "./effects/ObsidianPlatform";
import { adfToMergeMarkdown } from "./sync/adfMarkdown";
import { createConfluenceRemote, type ConfluenceRemote } from "./sync/confluenceRemote";
import { createObsidianPullVault, linkedPageId } from "./sync/obsidianVault";
import { PullService } from "./sync/pull";
import { PullResultsModal, summarizePull } from "./sync/PullResultsModal";
import { checkBeforePublish, type NoteToPublish } from "./sync/publishGate";
import { createSyncStateStore, type SyncStateStore } from "./sync/syncState";
import {
	ObsidianPluginSettings,
	mergeSettings,
	migrateSecretsToStorage,
	toPersistedSettings,
	withResolvedSecrets,
} from "./settings";

const PUBLISH_FLAG = "connie-publish";
/** The publisher's error when a page was last edited by someone else. */
const EDITED_BY_OTHER_USER = "Page last updated by another user";

type ConfluenceClient = Awaited<ReturnType<typeof createObsidianConfluenceClient>>;

/** Obsidian's bundled Mermaid; only the part used to copy the user's diagram config. */
interface ObsidianMermaid {
	mermaidAPI: { getConfig(): MermaidConfig };
}

/** Undocumented but long-standing Vault API for reading app config such as the active theme. */
type VaultWithConfig = Vault & { getConfig?: (key: string) => unknown };

export default class ConfluencePlugin extends Plugin {
	settings!: ObsidianPluginSettings;
	private isSyncing = false;
	private publishAbort: AbortController | undefined;
	private publishStatus: HTMLElement | undefined;
	private syncState!: SyncStateStore;
	private platform!: Layer.Layer<MarkdownConfluencePlatform>;
	private settingsLayer!: Layer.Layer<ConfluenceUploadSettings.ConfluenceSettingsService>;

	browserOAuth = new BrowserOAuth(
		() => this.settings,
		() => this.app.secretStorage,
		() => this.saveSettings(),
		(url) => {
			window.open(url, "_blank", "noopener,noreferrer");
		},
	);

	override async onload() {
		await this.loadSettings();
		const pluginDir =
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		this.syncState = createSyncStateStore(
			this.app.vault.adapter,
			normalizePath(`${pluginDir}/sync`),
		);

		this.publishStatus = this.addStatusBarItem();
		this.publishStatus.addClass("confluence-publish-status");
		this.registerDomEvent(this.publishStatus, "click", () => this.cancelSync());

		this.addRibbonIcon("cloud-upload", "Publish to Confluence", () => {
			void this.runPublish();
		});
		this.addRibbonIcon("cloud-download", "Pull from Confluence", () => {
			void this.runPull();
		});

		this.addCommand({
			id: "pull-current",
			name: "Pull current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				const pageId = file ? linkedPageId(this.app, file) : undefined;
				if (!pageId) return false;
				if (!checking) void this.runPull([pageId]);
				return true;
			},
		});

		this.addCommand({
			id: "pull-all",
			name: "Pull all notes",
			callback: () => {
				void this.runPull();
			},
		});

		this.addCommand({
			id: "publish-current",
			name: "Publish current note",
			checkCallback: (checking) => {
				const activePath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
				if (!activePath) return false;
				if (!checking) void this.runPublish(activePath);
				return true;
			},
		});

		this.addCommand({
			id: "publish-all",
			name: "Publish all notes",
			callback: () => {
				void this.runPublish();
			},
		});

		this.addCommand({
			id: "cancel-publish",
			name: "Cancel publish or pull after the current request",
			checkCallback: (checking) => {
				if (!this.isSyncing) return false;
				if (!checking) this.cancelSync();
				return true;
			},
		});

		this.addCommand({
			id: "enable-publishing",
			name: "Enable publishing for current note",
			editorCheckCallback: (checking, _editor, view) => {
				const file = view.file;
				if (!file || this.isPublished(file) || this.isExcluded(file)) return false;
				if (!checking) void this.setPublishFlag(file, true);
				return true;
			},
		});

		this.addCommand({
			id: "disable-publishing",
			name: "Disable publishing for current note",
			editorCheckCallback: (checking, _editor, view) => {
				const file = view.file;
				if (!file || !this.isPublished(file)) return false;
				if (!checking) void this.setPublishFlag(file, false);
				return true;
			},
		});

		this.addCommand({
			id: "page-settings",
			name: "Edit page settings for current note",
			editorCheckCallback: (checking, _editor, view) => {
				const file = view.file;
				if (!file) return false;
				if (!checking) this.openPageSettings(file);
				return true;
			},
		});

		this.addSettingTab(new ConfluenceSettingTab(this.app, this));
	}

	override onunload() {
		this.browserOAuth.cancel();
		this.publishAbort?.abort();
	}

	async loadSettings() {
		this.settings = mergeSettings(await this.loadData());
		if (migrateSecretsToStorage(this.settings, this.app.secretStorage)) {
			await this.saveSettings();
			new Notice(
				"Confluence credentials were moved from plugin data into Obsidian secret storage.",
			);
			return;
		}
		this.buildLayers();
	}

	async saveSettings() {
		await this.saveData(toPersistedSettings(this.settings));
		this.buildLayers();
	}

	/** Settings with credentials read from secret storage, for authenticating requests only. */
	resolvedSettings(): ObsidianPluginSettings {
		return withResolvedSecrets(this.settings, this.app.secretStorage);
	}

	async authenticationClient() {
		const settings = this.resolvedSettings();
		const browser = settings.confluenceAuthType === "oauth2" && settings.oauthMode === "browser";
		if (browser) {
			const site = settings.oauthSites.find((item) => item.id === settings.oauthSiteId);
			if (!site) throw new Error("Connect and choose a Confluence site in settings.");
			if (settings.confluenceBaseUrl !== `https://api.atlassian.com/ex/confluence/${site.id}`)
				throw new Error(
					"The selected OAuth site differs from the publish destination. Choose your site again.",
				);
		}
		return createObsidianConfluenceClient(
			settings,
			browser ? await this.browserOAuth.accessToken() : undefined,
		);
	}

	async selectOAuthSite(id: string) {
		const site = this.settings.oauthSites.find((item) => item.id === id);
		if (!site) throw new Error("Choose an authorized Confluence site.");
		this.settings.oauthSiteId = id;
		this.settings.confluenceBaseUrl = `https://api.atlassian.com/ex/confluence/${site.id}`;
		this.settings.confluenceSiteUrl = site.url;
		await this.saveSettings();
	}

	private buildLayers() {
		this.platform = ObsidianPlatformLive(this.app);
		this.settingsLayer = Layer.succeed(
			ConfluenceUploadSettings.ConfluenceSettingsService,
			this.settings,
		);
	}

	private isPublished(file: TFile): boolean {
		return shouldPublishMarkdownFile(file.path, this.frontmatter(file), this.settings);
	}

	/** Excluded folders override `connie-publish: true`, so enabling there would have no effect. */
	private isExcluded(file: TFile): boolean {
		return !shouldPublishMarkdownFile(file.path, { [PUBLISH_FLAG]: true }, this.settings);
	}

	/** Whether the note is selected by folder or tag alone, ignoring its `connie-publish` flag. */
	private isPublishedByDefault(file: TFile): boolean {
		const frontmatter: Record<string, unknown> = { ...this.frontmatter(file) };
		delete frontmatter[PUBLISH_FLAG];
		return shouldPublishMarkdownFile(file.path, frontmatter, this.settings);
	}

	private frontmatter(file: TFile): FrontMatterCache | undefined {
		return this.app.metadataCache.getFileCache(file)?.frontmatter;
	}

	private async setPublishFlag(file: TFile, publish: boolean) {
		const byDefault = this.isPublishedByDefault(file);
		try {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					if (publish === byDefault) delete frontmatter[PUBLISH_FLAG];
					else frontmatter[PUBLISH_FLAG] = publish;
				},
			);
		} catch (error) {
			new Notice(`Could not update ${file.name}: ${toError(error).message}`);
		}
	}

	private openPageSettings(file: TFile) {
		new ConfluencePerPageForm(this.app, {
			config: ConfluencePageConfig.conniePerPageConfig,
			initialValues: mapFrontmatterToConfluencePerPageUIValues(this.frontmatter(file)),
			onSubmit: async (values, close) => {
				const config = ConfluencePageConfig.conniePerPageConfig;
				try {
					await this.app.fileManager.processFrontMatter(
						file,
						(frontmatter: Record<string, unknown>) => {
							for (const [property, entry] of Object.entries(values)) {
								if (!entry.isSet) continue;
								const { key } = config[property as keyof typeof config];
								frontmatter[key] = entry.value;
							}
						},
					);
					close();
				} catch (error) {
					new Notice(`Could not update ${file.name}: ${toError(error).message}`);
				}
			},
		}).open();
	}

	private cancelSync() {
		if (!this.publishAbort) return;
		this.publishAbort.abort();
		new Notice("Cancellation requested. Completed writes will be kept.");
	}

	/** Run one publish or pull at a time, with cancellation and status bar progress. */
	private async runExclusive(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
		if (this.isSyncing) {
			new Notice("A Confluence publish or pull is already in progress.");
			return;
		}
		this.isSyncing = true;
		this.publishAbort = new AbortController();
		try {
			await task(this.publishAbort.signal);
		} finally {
			this.isSyncing = false;
			this.publishAbort = undefined;
			this.publishStatus?.empty();
		}
	}

	private setStatus(message: string) {
		this.publishStatus?.setText(`${message} · click to cancel`);
	}

	private async runPull(pageIds?: string[]): Promise<void> {
		await this.runExclusive(async (signal) => {
			try {
				const settings = this.resolvedSettings();
				const client = await this.authenticationClient();
				const service = new PullService(
					createConfluenceRemote(client),
					createObsidianPullVault(this.app),
					this.syncState,
				);
				const importNew = settings.importNewPages && !pageIds && settings.confluenceParentId;
				const report = await service.pull({
					confluenceBaseUrl: settings.confluenceBaseUrl,
					...(pageIds ? { pageIds } : {}),
					...(importNew
						? {
								importUnder: {
									rootPageId: settings.confluenceParentId,
									rootFolder: settings.folderToPublish,
								},
							}
						: {}),
					signal,
					onProgress: (message) => this.setStatus(message),
				});
				if (this.settings.showPublishResultsModal || report.conflicted.length > 0)
					new PullResultsModal(this.app, report).open();
				else new Notice(summarizePull(report), 10000);
			} catch (error) {
				new PullResultsModal(this.app, { errorMessage: toError(error).message }).open();
			}
		});
	}

	private async runPublish(publishFilter?: string): Promise<void> {
		await this.runExclusive(async (signal) => {
			try {
				this.showPublishResults(await this.doPublish(signal, publishFilter));
			} catch (error) {
				this.showPublishResults({
					errorMessage: toError(error).message,
					failedFiles: [],
					filesUploadResult: [],
				});
			}
		});
	}

	private async doPublish(signal: AbortSignal, publishFilter?: string): Promise<UploadResults> {
		const client = await this.authenticationClient();
		const remote = createConfluenceRemote(client);
		const check = await checkBeforePublish(
			await this.notesToPublish(publishFilter),
			remote,
			this.syncState,
		);
		if (check.blocked.length > 0) {
			return {
				errorMessage:
					"Nothing was published. Like a rejected git push, these notes need attention first:",
				failedFiles: check.blocked,
				filesUploadResult: [],
			};
		}

		const publisher = await this.createPublisher(client);
		const results = await this.runObsidianEffect(
			publisher.publishEffect(publishFilter, { signal }),
		);

		const uploadResults: UploadResults = {
			errorMessage: null,
			failedFiles: [],
			filesUploadResult: [],
		};
		for (const result of results) {
			const path = toVaultPath(result.node.file.absoluteFilePath);
			let uploaded = result.successfulUploadResult;
			let reason = result.reason;
			// The page was last edited by someone else, but that edit is exactly the version
			// that was pulled and merged into this note, so it's safe to publish over it.
			if (!uploaded && reason?.includes(EDITED_BY_OTHER_USER) && check.upToDate.has(path)) {
				signal.throwIfAborted();
				const retry = await this.publishOverMergedEdit(client, path, signal);
				uploaded = retry.uploaded;
				reason = retry.reason;
			}
			if (uploaded) uploadResults.filesUploadResult.push(uploaded);
			else
				uploadResults.failedFiles.push({
					fileName: path,
					reason: reason ?? "No reason provided",
				});
		}

		const baseErrors = await this.recordPublishedBases(remote, uploadResults.filesUploadResult);
		uploadResults.failedFiles.push(...baseErrors);
		return uploadResults;
	}

	private async publishOverMergedEdit(client: ConfluenceClient, path: string, signal: AbortSignal) {
		const publisher = await this.createPublisher(client, { forceOverwrite: true });
		const results = await this.runObsidianEffect(publisher.publishEffect(path, { signal }));
		const result = results.find((entry) => toVaultPath(entry.node.file.absoluteFilePath) === path);
		return { uploaded: result?.successfulUploadResult, reason: result?.reason };
	}

	/** After publishing, remember what Confluence now holds as the base for the next pull. */
	private async recordPublishedBases(
		remote: ConfluenceRemote,
		uploads: UploadResults["filesUploadResult"],
	): Promise<UploadResults["failedFiles"]> {
		const errors: UploadResults["failedFiles"] = [];
		for (const upload of uploads) {
			const { pageId, absoluteFilePath } = upload.adfFile;
			if (!pageId) continue;
			try {
				if (upload.contentResult === "same" && (await this.syncState.get(pageId))) continue;
				const page = await remote.getPage(pageId);
				if (!page) continue;
				await this.syncState.set({
					pageId,
					version: page.version,
					title: page.title,
					markdown: adfToMergeMarkdown(page.adf, this.settings.confluenceBaseUrl),
				});
			} catch (error) {
				errors.push({
					fileName: toVaultPath(absoluteFilePath),
					reason: `Published, but the pull base could not be saved: ${toError(error).message}`,
				});
			}
		}
		return errors;
	}

	/** The notes a publish will send, so they can be checked against Confluence first. */
	private async notesToPublish(publishFilter?: string): Promise<NoteToPublish[]> {
		const files = publishFilter
			? [this.app.vault.getFileByPath(publishFilter)].filter((file) => file !== null)
			: this.app.vault
					.getMarkdownFiles()
					.filter((file) =>
						shouldPublishMarkdownFile(file.path, this.frontmatter(file), this.settings),
					);
		return Promise.all(
			files.map(async (file) => ({
				path: file.path,
				pageId: linkedPageId(this.app, file),
				text: await this.app.vault.cachedRead(file),
			})),
		);
	}

	private async createPublisher(
		confluenceClient: ConfluenceClient,
		overrides: Partial<ObsidianPluginSettings> = {},
	) {
		const settings = { ...this.resolvedSettings(), ...overrides };
		const mermaidItems = await this.getMermaidItems();
		const mermaidRenderer = new ElectronMermaidRenderer(
			mermaidItems.extraStyleSheets,
			mermaidItems.extraStyles,
			mermaidItems.mermaidConfig,
			mermaidItems.bodyStyles,
			settings.mermaid,
		);

		const plugins: ADFProcessingPlugin<unknown, unknown>[] = [
			new MathRendererPlugin(new ElectronMathRenderer()),
			new MermaidRendererPlugin(mermaidRenderer),
		];

		if (settings.kroki?.enabled)
			plugins.push(
				new KrokiRendererPlugin(
					new HttpKrokiRenderer({ ...settings.kroki, fetchImpl: krokiFetch }),
				),
			);
		if (settings.plantuml.enabled) {
			if (settings.plantuml.serverUrl) {
				plugins.push(
					new PlantumlRendererPlugin(
						new HttpPlantumlRenderer({ serverUrl: settings.plantuml.serverUrl }),
					),
				);
			} else {
				new Notice(
					"PlantUML rendering is enabled but the PlantUML server URL is empty. Set it in the plugin settings.",
				);
			}
		}

		return new Publisher(settings, confluenceClient, plugins, (message) => this.setStatus(message));
	}

	private async getMermaidItems() {
		const extraStyles: string[] = [];
		const extraStyleSheets: string[] = [];
		let bodyStyles = "";

		switch (this.settings.mermaidTheme) {
			case "default":
			case "neutral":
			case "dark":
			case "forest":
				return {
					extraStyleSheets,
					extraStyles,
					mermaidConfig: { theme: this.settings.mermaidTheme } satisfies MermaidConfig,
					bodyStyles,
				};
			case "match-obsidian":
				bodyStyles = document.body.className;
				break;
			case "dark-obsidian":
				bodyStyles = "theme-dark";
				break;
			case "light-obsidian":
				bodyStyles = "theme-light";
				break;
		}

		extraStyleSheets.push("app://obsidian.md/app.css");

		const cssTheme = this.getVaultConfig("cssTheme");
		if (typeof cssTheme === "string" && cssTheme) {
			const themeCss = await this.readConfigCss("themes", cssTheme, "theme.css");
			if (themeCss) extraStyles.push(themeCss);
		}

		const cssSnippets = this.getVaultConfig("enabledCssSnippets");
		if (Array.isArray(cssSnippets)) {
			for (const snippet of cssSnippets) {
				if (typeof snippet !== "string") continue;
				const snippetCss = await this.readConfigCss("snippets", `${snippet}.css`);
				if (snippetCss) extraStyles.push(snippetCss);
			}
		}

		const mermaid = (await loadMermaid()) as ObsidianMermaid;
		const mermaidConfig: MermaidConfig = {
			...mermaid.mermaidAPI.getConfig(),
			theme: bodyStyles.split(/\s+/).includes("theme-dark") ? "dark" : "default",
		};
		// Recompute colors for the selected theme instead of reusing Obsidian's
		// previously derived colors, which can leave dark arrows on a dark image.
		delete mermaidConfig.themeVariables;
		return { extraStyleSheets, extraStyles, mermaidConfig, bodyStyles };
	}

	private getVaultConfig(key: string): unknown {
		return (this.app.vault as VaultWithConfig).getConfig?.(key);
	}

	/**
	 * Read a CSS file from the config directory. The Vault API does not index the config
	 * directory, so the adapter is required here. Names come from app config, so any
	 * segment that could leave the config directory is rejected.
	 */
	private async readConfigCss(...segments: string[]): Promise<string | undefined> {
		if (segments.some((segment) => !segment || segment === ".." || /[\\/]/.test(segment)))
			return undefined;
		const path = normalizePath([this.app.vault.configDir, ...segments].join("/"));
		if (!(await this.app.vault.adapter.exists(path))) return undefined;
		return this.app.vault.adapter.read(path);
	}

	private runObsidianEffect<A, E>(
		effect: Effect.Effect<A, E, MarkdownConfluencePlatform | MarkdownWorkspaceService>,
	): Promise<A> {
		return Effect.runPromise(
			effect.pipe(
				Effect.provide(MarkdownWorkspaceLive),
				Effect.provideService(
					MarkdownSourceTransformerService,
					createDataviewTransformer(this.app, this.settings),
				),
				Effect.provide(this.settingsLayer),
				Effect.provide(this.platform),
				Effect.mapError(toError),
			),
		);
	}

	private showPublishResults(uploadResults: UploadResults) {
		if (this.settings.showPublishResultsModal) {
			new CompletedModal(this.app, { uploadResults }).open();
			return;
		}
		new Notice(getPublishResultsMessage(uploadResults), 10000);
	}
}

/** The publisher reports paths relative to the vault, sometimes with a leading slash. */
function toVaultPath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function toError(error: unknown): Error {
	if (error instanceof Error) return error;
	return new Error(typeof error === "string" ? error : JSON.stringify(error));
}

function getPublishResultsMessage(uploadResults: UploadResults): string {
	if (uploadResults.errorMessage) {
		return `Confluence publish failed: ${uploadResults.errorMessage}`;
	}
	if (uploadResults.failedFiles.length > 0) {
		return `Confluence publish finished: ${uploadResults.filesUploadResult.length} succeeded, ${uploadResults.failedFiles.length} failed.`;
	}
	return `Confluence publish finished: ${uploadResults.filesUploadResult.length} file(s) processed.`;
}
