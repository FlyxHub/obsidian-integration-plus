import "./markdownIt";
import { MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import {
	ADFProcessingPlugin,
	ConfluencePageConfig,
	ConfluenceUploadSettings,
	createAuthenticatedConfluenceClient,
	HttpKrokiRenderer,
	KrokiRendererPlugin,
	MarkdownConfluencePlatform,
	type ConfluenceFetch,
	type MarkdownSourceTransformer,
	MarkdownSourceTransformerService,
	MarkdownWorkspaceLive,
	MarkdownWorkspaceService,
	MathRendererPlugin,
	MermaidRendererPlugin,
	PlantumlRendererPlugin,
	Publisher,
	shouldPublishMarkdownFile,
	validateConfluenceSettings,
} from "@markdown-confluence/lib";
import { Effect, Layer } from "effect";
import { HttpPlantumlRenderer } from "@markdown-confluence/plantuml-renderer";
import { BrowserOAuth } from "./BrowserOAuth";
import { normalizeCalloutsForPublish } from "./callouts";
import { CompletedModal, type UploadResults } from "./CompletedModal";
import {
	ConfluencePerPageForm,
	mapFrontmatterToConfluencePerPageUIValues,
} from "./ConfluencePerPageForm";
import { ConfluenceSettingTab } from "./ConfluenceSettingTab";
import { createDataviewTransformer } from "./DataviewTransformer";
import { desktopFetch } from "./desktopFetch";
import { ElectronMathRenderer, ElectronMermaidRenderer } from "./electronRenderers";
import { ObsidianPlatformLive } from "./effects/ObsidianPlatform";
import { errorMessage, toError } from "./errors";
import { PAGE_URL_KEY, PUBLISH_KEY } from "./frontmatterKeys";
import { sizeImageEmbeds, type ImageSizeLookup } from "./imageEmbeds";
import { imageSize } from "./imageSize";
import { krokiFetch } from "./KrokiFetch";
import { loadMermaidStyles, type MermaidStyles } from "./mermaidStyles";
import { toVaultPath } from "./paths";
import { isExcluded, publishFlagFor } from "./publishSelection";
import { wikilinksToPageLinks, type PageUrlLookup } from "./wikilinks";
import { createAttachmentDownloader } from "./sync/attachmentDownload";
import { createConfluenceRemote, type AttachmentDownload } from "./sync/confluenceRemote";
import { MediaSync } from "./sync/media";
import {
	createNoteFingerprinter,
	createObsidianPullVault,
	linkedPageId,
} from "./sync/obsidianVault";
import { notesForPartialPublish, partialWorkspace } from "./sync/partialPublish";
import { PullService } from "./sync/pull";
import { PullResultsModal, summarizePull } from "./sync/PullResultsModal";
import {
	checkBeforePublish,
	findChangedNotes,
	type NoteFingerprinter,
	type NoteToPublish,
} from "./sync/publishGate";
import { createSyncStateStore, type SyncStateStore } from "./sync/syncState";
import {
	ObsidianPluginSettings,
	describeSettingsIssue,
	mergeSettings,
	migrateSecretsToStorage,
	oauthApiUrl,
	toPersistedSettings,
	usesBrowserLogin,
	withBearerToken,
	withResolvedSecrets,
	withSiteUrlFallback,
} from "./settings";

/** Manifest ID of the plugin this one was forked from. */
const LEGACY_PLUGIN_ID = "confluence-integration";
/** The publisher's error when a page was last edited by someone else. */
const EDITED_BY_OTHER_USER = "Page last updated by another user";

type ConfluenceClient = Awaited<ReturnType<ConfluencePlugin["authenticationClient"]>>;

/** What a publish sends: one note, the notes changed since they were last in sync, or all. */
type PublishScope = { note: string } | "changes" | "all";

export default class ConfluencePlugin extends Plugin {
	declare settings: ObsidianPluginSettings;
	/** Set while a publish or pull runs; aborting it cancels after the current request. */
	private syncAbort: AbortController | undefined;
	private syncStatus: HTMLElement | undefined;
	private syncState!: SyncStateStore;

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

		this.syncStatus = this.addStatusBarItem();
		this.syncStatus.addClass("confluence-publish-status");
		this.registerDomEvent(this.syncStatus, "click", () => this.cancelSync());

		this.addRibbonIcon("cloud-upload", "Publish changes to Confluence", () => {
			void this.runPublish("changes");
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
				if (!checking) void this.runPublish({ note: activePath });
				return true;
			},
		});

		// The ID predates the rename to "Publish changes"; keeping it keeps users' hotkeys.
		this.addCommand({
			id: "publish-all",
			name: "Publish changes",
			callback: () => {
				void this.runPublish("changes");
			},
		});

		this.addCommand({
			id: "republish-all",
			name: "Republish all notes",
			callback: () => {
				void this.runPublish("all");
			},
		});

		this.addCommand({
			id: "cancel-publish",
			name: "Cancel publish or pull after the current request",
			checkCallback: (checking) => {
				if (!this.syncAbort) return false;
				if (!checking) this.cancelSync();
				return true;
			},
		});

		this.addCommand({
			id: "enable-publishing",
			name: "Enable publishing for current note",
			editorCheckCallback: (checking, _editor, view) => {
				const file = view.file;
				if (!file || this.isPublished(file) || isExcluded(file.path, this.settings)) return false;
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
		this.syncAbort?.abort();
	}

	async loadSettings() {
		let data: unknown = await this.loadData();
		let importedLegacy = false;
		if (data === null) {
			data = await this.readLegacySettings();
			importedLegacy = data !== undefined;
		}
		this.settings = mergeSettings(data);
		const movedSecrets = migrateSecretsToStorage(this.settings, this.app.secretStorage);
		if (!importedLegacy && !movedSecrets) return;
		await this.saveSettings();
		if (importedLegacy)
			new Notice("Imported your settings from the original Confluence Integration plugin.");
		if (movedSecrets)
			new Notice(
				"Confluence credentials were moved from plugin data into Obsidian secret storage.",
			);
	}

	/**
	 * Settings of the plugin this one was forked from, so switching doesn't lose them.
	 * Read once, only while this plugin has no settings of its own. The adapter is used
	 * because the Vault API doesn't index the config directory.
	 */
	private async readLegacySettings(): Promise<unknown> {
		const path = normalizePath(`${this.app.vault.configDir}/plugins/${LEGACY_PLUGIN_ID}/data.json`);
		try {
			if (!(await this.app.vault.adapter.exists(path))) return undefined;
			return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
		} catch {
			return undefined;
		}
	}

	async saveSettings() {
		await this.saveData(toPersistedSettings(this.settings));
	}

	/** Settings with credentials read from secret storage, for authenticating requests only. */
	resolvedSettings(): ObsidianPluginSettings {
		return withSiteUrlFallback(withResolvedSecrets(this.settings, this.app.secretStorage));
	}

	/** Built for each publish or pull, so a vault left open never keeps an expired OAuth token. */
	async authenticationClient(fetch: ConfluenceFetch = desktopFetch) {
		const settings = this.resolvedSettings();
		const browser = usesBrowserLogin(settings);
		if (browser) {
			const site = settings.oauthSites.find((item) => item.id === settings.oauthSiteId);
			if (!site) throw new Error("Connect and choose a Confluence site in settings.");
			if (settings.confluenceBaseUrl !== oauthApiUrl(site.id))
				throw new Error(
					"The selected OAuth site differs from the publish destination. Choose your site again.",
				);
		}
		const oauthAccessToken = browser ? await this.browserOAuth.accessToken() : undefined;
		const validation = validateConfluenceSettings(
			oauthAccessToken ? withBearerToken(settings, oauthAccessToken) : settings,
		);
		if (!validation.valid) throw new Error(validation.issues.map(describeSettingsIssue).join("\n"));
		return Effect.runPromise(
			createAuthenticatedConfluenceClient(settings, {
				fetch,
				...(oauthAccessToken ? { oauthAccessToken } : {}),
			}),
		);
	}

	async selectOAuthSite(id: string) {
		const site = this.settings.oauthSites.find((item) => item.id === id);
		if (!site) throw new Error("Choose an authorized Confluence site.");
		this.settings.oauthSiteId = id;
		this.settings.confluenceBaseUrl = oauthApiUrl(site.id);
		this.settings.confluenceSiteUrl = site.url;
		await this.saveSettings();
	}

	private isPublished(file: TFile): boolean {
		return shouldPublishMarkdownFile(file.path, this.frontmatter(file), this.settings);
	}

	private frontmatter(file: TFile) {
		return this.app.metadataCache.getFileCache(file)?.frontmatter;
	}

	private async setPublishFlag(file: TFile, publish: boolean) {
		const flag = publishFlagFor(file.path, this.frontmatter(file), this.settings, publish);
		await this.editFrontmatter(file, (frontmatter) => {
			if (flag === undefined) delete frontmatter[PUBLISH_KEY];
			else frontmatter[PUBLISH_KEY] = flag;
		});
	}

	private openPageSettings(file: TFile) {
		const config = ConfluencePageConfig.conniePerPageConfig;
		new ConfluencePerPageForm(this.app, {
			initialValues: mapFrontmatterToConfluencePerPageUIValues(this.frontmatter(file)),
			onSubmit: async (values, close) => {
				const saved = await this.editFrontmatter(file, (frontmatter) => {
					for (const [property, entry] of Object.entries(values)) {
						if (!entry.isSet) continue;
						const { key } = config[property as keyof typeof config];
						frontmatter[key] = entry.value;
					}
				});
				if (saved) close();
			},
		}).open();
	}

	/** Change a note's frontmatter, with a notice on failure. Returns whether it was saved. */
	private async editFrontmatter(
		file: TFile,
		edit: (frontmatter: Record<string, unknown>) => void,
	): Promise<boolean> {
		try {
			await this.app.fileManager.processFrontMatter(file, edit);
			return true;
		} catch (error) {
			new Notice(`Could not update ${file.name}: ${errorMessage(error)}`);
			return false;
		}
	}

	private cancelSync() {
		if (!this.syncAbort) return;
		this.syncAbort.abort();
		new Notice("Cancellation requested. Completed writes will be kept.");
	}

	/** Run one publish or pull at a time, with cancellation and status bar progress. */
	private async runExclusive(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
		if (this.syncAbort) {
			new Notice("A Confluence publish or pull is already in progress.");
			return;
		}
		this.syncAbort = new AbortController();
		try {
			await task(this.syncAbort.signal);
		} finally {
			this.syncAbort = undefined;
			this.syncStatus?.empty();
		}
	}

	private setStatus(message: string) {
		this.syncStatus?.setText(`${message} · click to cancel`);
	}

	/** Pull and publish-time base recording share one service, with the same image handling. */
	private createPullService(client: ConfluenceClient, download?: AttachmentDownload): PullService {
		const remote = createConfluenceRemote(client, download);
		const vault = createObsidianPullVault(
			this.app,
			createNoteFingerprinter(this.app, this.settings),
		);
		const media = new MediaSync(remote, vault, this.syncState, this.settings.imageFolder);
		return new PullService(remote, vault, this.syncState, media);
	}

	private async runPull(pageIds?: string[]): Promise<void> {
		await this.runExclusive(async (signal) => {
			try {
				const settings = this.resolvedSettings();
				const downloader = createAttachmentDownloader(desktopFetch);
				const client = await this.authenticationClient(downloader.fetch);
				const service = this.createPullService(client, downloader.download);
				const importNew = settings.importNewPages && !pageIds && settings.confluenceParentId;
				const report = await service.pull({
					confluenceBaseUrl: settings.confluenceBaseUrl,
					confluenceSiteUrl: settings.confluenceSiteUrl,
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
				new PullResultsModal(this.app, { errorMessage: errorMessage(error) }).open();
			}
		});
	}

	private async runPublish(scope: PublishScope): Promise<void> {
		await this.runExclusive(async (signal) => {
			try {
				const results = await this.doPublish(signal, scope);
				if (results) this.showPublishResults(results);
				else
					new Notice(
						"No notes changed since they were last published or pulled. To publish every note again, republish all notes from the command palette.",
					);
			} catch (error) {
				this.showPublishResults({
					errorMessage: errorMessage(error),
					failedFiles: [],
					filesUploadResult: [],
				});
			}
		});
	}

	/** Publish the notes in scope. Returns undefined when publishing changes and none changed. */
	private async doPublish(
		signal: AbortSignal,
		scope: PublishScope,
	): Promise<UploadResults | undefined> {
		const client = await this.authenticationClient();
		const fingerprint = createNoteFingerprinter(this.app, this.settings);
		const publishFilter = typeof scope === "object" ? scope.note : undefined;
		const candidates = await this.notesToPublish(publishFilter);
		const notes =
			scope === "changes"
				? await findChangedNotes(candidates, this.syncState, fingerprint)
				: candidates;
		if (notes.length === 0) return undefined;
		const changed = scope === "changes" ? new Set(notes.map((note) => note.path)) : undefined;
		// Publishing changes hands the lib only the changed notes and the folder notes the page
		// tree needs around them. Those are published too, so they go through the check as well.
		const selection = changed
			? notesForPartialPublish(
					candidates.map((note) => note.path),
					[...changed],
				)
			: undefined;
		const partial = selection ? new Set(selection) : undefined;
		const toCheck = changed
			? candidates.filter((note) => !partial || partial.has(note.path))
			: notes;

		const check = await checkBeforePublish(toCheck, createConfluenceRemote(client), this.syncState);
		if (check.blocked.length > 0) {
			return {
				errorMessage:
					"Nothing was published. Like a rejected git push, these notes need attention first:",
				failedFiles: check.blocked,
				filesUploadResult: [],
			};
		}

		const mermaidStyles = await loadMermaidStyles(this.app, this.settings.mermaidTheme);
		// A partial publish never overwrites other users' edits on the unchanged folder notes
		// it includes, and page ordering needs every sibling, so it only runs on full publishes.
		const publisher = this.createPublisher(
			client,
			mermaidStyles,
			changed ? { forceOverwrite: false, orderPages: false } : {},
		);
		const results = await this.runObsidianEffect(
			publisher.publishEffect(publishFilter, { signal }),
			partial,
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
			const editedByOtherUser = !uploaded && !!reason?.includes(EDITED_BY_OTHER_USER);
			// Unchanged notes included only for the page tree aren't reported, unless they failed.
			if (changed && !changed.has(path) && (uploaded || editedByOtherUser)) continue;
			// The page was last edited by someone else, but that edit is exactly the version
			// that was pulled and merged into this note, so it's safe to publish over it. A
			// partial publish also applies the "Overwrite other users' edits" setting here.
			const mayOverwrite =
				check.upToDate.has(path) || (changed !== undefined && this.settings.forceOverwrite);
			if (editedByOtherUser && mayOverwrite) {
				signal.throwIfAborted();
				const forced = this.createPublisher(client, mermaidStyles, { forceOverwrite: true });
				const retry = (await this.runObsidianEffect(forced.publishEffect(path, { signal }))).find(
					(entry) => toVaultPath(entry.node.file.absoluteFilePath) === path,
				);
				uploaded = retry?.successfulUploadResult;
				reason = retry?.reason;
			}
			if (uploaded) uploadResults.filesUploadResult.push(uploaded);
			else
				uploadResults.failedFiles.push({
					fileName: path,
					reason: reason ?? "No reason provided",
				});
		}

		uploadResults.failedFiles.push(
			...(await this.recordPublishedBases(client, uploadResults.filesUploadResult, fingerprint)),
		);
		return uploadResults;
	}

	/**
	 * After publishing, remember what Confluence now holds as the base for the next pull, and
	 * each note's fingerprint, so the next "Publish changes" skips it until it changes.
	 */
	private async recordPublishedBases(
		client: ConfluenceClient,
		uploads: UploadResults["filesUploadResult"],
		fingerprint: NoteFingerprinter,
	): Promise<UploadResults["failedFiles"]> {
		const pathsById = new Map<string, string>();
		const pages = [];
		for (const { adfFile, contentResult } of uploads) {
			if (!adfFile.pageId) continue;
			const path = toVaultPath(adfFile.absoluteFilePath);
			pathsById.set(adfFile.pageId, path);
			pages.push({
				pageId: adfFile.pageId,
				unchanged: contentResult === "same",
				fingerprint: await fingerprint(path),
			});
		}
		const failures = await this.createPullService(client).recordPublished(
			pages,
			this.resolvedSettings(),
		);
		return failures.map(({ pageId, reason }) => ({
			fileName: pathsById.get(pageId) ?? pageId,
			reason: `Published, but the pull base could not be saved: ${reason}`,
		}));
	}

	/** The notes a publish will send, so they can be checked against Confluence first. */
	private async notesToPublish(publishFilter?: string): Promise<NoteToPublish[]> {
		const files = publishFilter
			? [this.app.vault.getFileByPath(publishFilter)].filter((file) => file !== null)
			: this.app.vault.getMarkdownFiles().filter((file) => this.isPublished(file));
		return Promise.all(
			files.map(async (file) => ({
				path: file.path,
				pageId: linkedPageId(this.app, file),
				text: await this.app.vault.cachedRead(file),
			})),
		);
	}

	private createPublisher(
		confluenceClient: ConfluenceClient,
		mermaidStyles: MermaidStyles,
		overrides: Partial<ObsidianPluginSettings> = {},
	) {
		const settings = { ...this.resolvedSettings(), ...overrides };
		const mermaidRenderer = new ElectronMermaidRenderer(
			mermaidStyles.extraStyleSheets,
			mermaidStyles.extraStyles,
			mermaidStyles.mermaidConfig,
			mermaidStyles.bodyStyles,
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

	/** Run a lib effect in Obsidian; `onlyNotes` narrows the workspace for a partial publish. */
	private runObsidianEffect<A, E>(
		effect: Effect.Effect<A, E, MarkdownConfluencePlatform | MarkdownWorkspaceService>,
		onlyNotes?: ReadonlySet<string>,
	): Promise<A> {
		const workspace = onlyNotes
			? partialWorkspace(onlyNotes).pipe(Layer.provide(MarkdownWorkspaceLive))
			: MarkdownWorkspaceLive;
		return Effect.runPromise(
			effect.pipe(
				Effect.provide(workspace),
				Effect.provideService(MarkdownSourceTransformerService, this.sourceTransformer()),
				Effect.provide(
					Layer.succeed(
						ConfluenceUploadSettings.ConfluenceSettingsService,
						withSiteUrlFallback(this.settings),
					),
				),
				Effect.provide(ObsidianPlatformLive(this.app)),
				Effect.mapError(toError),
			),
		);
	}

	/**
	 * Publish-time Markdown changes: Dataview results, callouts shaped for panels, links to
	 * published notes, and image embeds with explicit sizes. None of them change the note.
	 */
	private sourceTransformer(): MarkdownSourceTransformer {
		const dataview = createDataviewTransformer(this.app, this.settings);
		const maxImageWidth = this.settings.maxImageWidth;
		return {
			transform: (markdown, context) =>
				dataview.transform(markdown, context).pipe(
					Effect.map(normalizeCalloutsForPublish),
					Effect.map((text) =>
						wikilinksToPageLinks(text, this.pageUrlLookup(toVaultPath(context.absoluteFilePath))),
					),
					Effect.flatMap((text) =>
						Effect.tryPromise({
							try: () =>
								sizeImageEmbeds(
									text,
									this.imageSizeLookup(toVaultPath(context.absoluteFilePath)),
									maxImageWidth,
								),
							catch: toError,
						}),
					),
				),
		};
	}

	/** Finds the page URL of the note a link points to, resolving links as Obsidian does. */
	private pageUrlLookup(sourcePath: string): PageUrlLookup {
		return (link) => {
			const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
			const url: unknown = file
				? this.app.metadataCache.getFileCache(file)?.frontmatter?.[PAGE_URL_KEY]
				: undefined;
			return typeof url === "string" && url.startsWith("https://") ? url : undefined;
		};
	}

	/** Reads the size of images that a note embeds, resolving links as Obsidian does. */
	private imageSizeLookup(sourcePath: string): ImageSizeLookup {
		return async (link) => {
			const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
			if (!file) return undefined;
			return imageSize(new Uint8Array(await this.app.vault.readBinary(file)));
		};
	}

	private showPublishResults(uploadResults: UploadResults) {
		if (this.settings.showPublishResultsModal) {
			new CompletedModal(this.app, { uploadResults }).open();
			return;
		}
		new Notice(getPublishResultsMessage(uploadResults), 10000);
	}
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
