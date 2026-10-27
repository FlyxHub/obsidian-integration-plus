import { errorMessage } from "../errors";
import { KEEP_PARENT_KEY, PAGE_ID_KEY, PAGE_TITLE_KEY, PUBLISH_KEY } from "../frontmatterKeys";
import { joinPath, parentOf } from "../paths";
import { MERGE_FORMAT, adfToMergeMarkdown, neutralizeLegacyBase } from "./adfMarkdown";
import type { ConfluenceRemote, RemoteChild, RemotePage } from "./confluenceRemote";
import { mediaReferences, mermaidDiagrams, type MediaResolver, type MediaSync } from "./media";
import {
	hasConflictMarkers,
	mergeThreeWay,
	mergeTwoWay,
	sameLines,
	splitFrontmatter,
} from "./merge";
import { createPageLinkResolver, rewritePageLinks, type PageLinkResolver } from "./pageLinks";
import { isFolderNote } from "./partialPublish";
import { toNoteName } from "./names";
import type { SyncStateStore } from "./syncState";

/** Vault operations pull needs; implemented with the Obsidian API in main.ts. */
export interface PullVault {
	/** Page ID → vault path, for every note with `connie-page-id`; the first note per page. */
	linkedNotes(): Map<string, string>;
	/** Pages that more than one note is linked to, such as after copying a note. */
	duplicateLinks?(): { pageId: string; paths: string[] }[];
	/** Paths of every Markdown note in the vault, to choose link text like Obsidian does. */
	notePaths(): string[];
	read(path: string): Promise<string>;
	/** Replace the note's text, failing if it changed since `expected` was read. */
	replace(path: string, expected: string, next: string): Promise<void>;
	/** Set frontmatter keys on a note. */
	setFrontmatter(path: string, values: Record<string, string>): Promise<void>;
	/** True when a file or folder has this path, ignoring case where the file system does. */
	pathInUse(path: string): Promise<boolean>;
	/** Create a note, and any missing parent folders. */
	create(path: string, body: string, frontmatter: Record<string, string | boolean>): Promise<void>;
	/** The note's current fingerprint, or undefined when it must always be published. */
	fingerprint(path: string): Promise<string | undefined>;
}

export interface SiteUrls {
	confluenceBaseUrl: string;
	/** The browser address of the site, which page links in Confluence content point to. */
	confluenceSiteUrl: string;
}

export interface PullOptions extends SiteUrls {
	/** Pull only these page IDs; all linked notes when undefined. */
	pageIds?: readonly string[];
	/** Discard local body edits instead of merging; used by explicit overwrite commands. */
	overwrite?: boolean;
	/** Import pages under this root page that have no note yet. */
	importUnder?: { rootPageId: string; rootFolder: string };
	signal?: AbortSignal;
	onProgress?: (message: string) => void;
}

export interface ImportPageOptions extends SiteUrls {
	pageId: string;
	folder: string;
	signal?: AbortSignal;
	onProgress?: (message: string) => void;
}

export interface ImportPageResult {
	path: string;
	title: string;
	/** Images that could not be downloaded; their ADF is preserved in the note. */
	warnings: string[];
}

export interface PullReport {
	updated: string[];
	conflicted: string[];
	imported: string[];
	renamed: { path: string; title: string }[];
	deleted: string[];
	skipped: { name: string; reason: string }[];
	/**
	 * Notes with no snapshot whose page you edited last. Confluence's version was taken as the
	 * base without changing the note; an edit you made in Confluence isn't in the note.
	 */
	noHistory: string[];
	unchanged: number;
	/** The pull was cancelled; the lists cover the notes handled before that. */
	cancelled?: boolean;
}

/** A page the publisher just uploaded. */
export interface PublishedPage {
	pageId: string;
	/** The publish left the page content as it was. */
	unchanged: boolean;
	/** The note's fingerprint after publishing; see `fingerprint.ts`. */
	fingerprint: string | undefined;
}

export interface ConvertedPage {
	markdown: string;
	/** Linked page IDs that have no note yet. */
	unresolvedLinks: string[];
	/** Media file IDs with no local copy; they stay `adf` fences. */
	unresolvedMedia: string[];
}

/**
 * Convert a page to the Markdown used for merging and importing: `adfToMergeMarkdown`, with
 * images embedded from their local copies, then links to pages that have notes become
 * wikilinks. Base and remote must both go through this, with the same resolvers, or links
 * and images show up as changes.
 */
export function convertPage(
	adf: unknown,
	urls: SiteUrls,
	resolve: PageLinkResolver,
	media: MediaResolver,
): ConvertedPage {
	const { markdown, unresolved } = rewritePageLinks(
		adfToMergeMarkdown(adf, urls.confluenceBaseUrl, media),
		urls.confluenceSiteUrl || urls.confluenceBaseUrl,
		resolve,
	);
	const unresolvedMedia = [
		...new Set(
			mediaReferences(adf)
				.map((reference) => reference.fileId)
				.filter((fileId) => !media(fileId)),
		),
	];
	return { markdown, unresolvedLinks: unresolved, unresolvedMedia };
}

interface PlannedImport {
	page: RemotePage;
	path: string;
	frontmatter: Record<string, string | boolean>;
}

const MAX_DEPTH = 50;

export class PullService {
	private accountId: string | undefined;

	constructor(
		private readonly remote: ConfluenceRemote,
		private readonly vault: PullVault,
		private readonly state: SyncStateStore,
		private readonly media: Pick<MediaSync, "ensure" | "resolver">,
	) {}

	/**
	 * Import the remote body before recording its base. Pulling into a blank linked note
	 * would leave it blank when the current user was the page's last editor.
	 */
	async importPage(options: ImportPageOptions): Promise<ImportPageResult> {
		options.signal?.throwIfAborted();
		options.onProgress?.(`Fetching page ${options.pageId}`);
		const page = await this.remote.getPage(options.pageId);
		options.signal?.throwIfAborted();
		if (!page)
			throw new Error(`Confluence page ${options.pageId} was not found or is inaccessible.`);
		// Reject duplicates and occupied paths before conversion can download any attachments.
		const linked = this.vault.linkedNotes();
		const existing = linked.get(page.id);
		if (existing) throw new Error(`Confluence page ${page.id} is already linked to ${existing}.`);

		const name = toNoteName(page.title, page.id);
		const path = joinPath(options.folder, `${name}.md`);
		if (await this.vault.pathInUse(path))
			throw new Error(
				`A file or folder already exists at ${path}. Choose another destination folder.`,
			);
		// Imported pages can publish from the chosen folder without moving their remote parent.
		const frontmatter: Record<string, string | boolean> = {
			[PAGE_ID_KEY]: page.id,
			[PUBLISH_KEY]: true,
			[KEEP_PARENT_KEY]: true,
		};
		// Preserve the remote title only when filename sanitizing changed it.
		if (name !== page.title) frontmatter[PAGE_TITLE_KEY] = page.title;
		// Include the planned note so links from the page to itself become local wikilinks.
		linked.set(page.id, path);
		const resolve = createPageLinkResolver(linked, [...this.vault.notePaths(), path]);
		const warnings: string[] = [];
		options.onProgress?.(`Importing ${path}`);
		await this.writeImport(
			{ page, path, frontmatter },
			options,
			resolve,
			(error) => warnings.push(`An image wasn't downloaded: ${error}`),
			options.signal,
		);
		return { path, title: page.title, warnings };
	}

	/** Replace one linked note with its remote body, bypassing merge and first-pull rules. */
	async overwritePage(options: Omit<ImportPageOptions, "folder">): Promise<PullReport> {
		return this.pull({ ...options, pageIds: [options.pageId], overwrite: true });
	}

	async pull(options: PullOptions): Promise<PullReport> {
		const report: PullReport = {
			updated: [],
			conflicted: [],
			imported: [],
			renamed: [],
			deleted: [],
			skipped: [],
			noHistory: [],
			unchanged: 0,
		};
		const linked = this.vault.linkedNotes();
		const pathsById = new Map(linked);
		// A page with two notes can't be merged into either; its base would advance for both.
		for (const { pageId, paths } of this.vault.duplicateLinks?.() ?? []) {
			linked.delete(pageId);
			for (const path of paths)
				report.skipped.push({
					name: path,
					reason: `${paths.find((other) => other !== path)} is linked to the same Confluence page. Remove ${PAGE_ID_KEY} from the copy, then pull again.`,
				});
		}
		// Plan imports before converting anything, so every pulled or imported note can link
		// to pages imported in this same pull.
		const planned =
			options.importUnder && !options.pageIds
				? await this.planImports(options, pathsById, report)
				: [];
		const resolve = createPageLinkResolver(pathsById, [
			...this.vault.notePaths(),
			...planned.map((entry) => entry.path),
		]);

		const ids = options.pageIds ?? [...linked.keys()];
		const versions = await this.remote.getVersions(ids);
		for (const [index, pageId] of ids.entries()) {
			if (options.signal?.aborted) return { ...report, cancelled: true };
			const path = linked.get(pageId);
			if (!path) continue;
			options.onProgress?.(`Pulling ${index + 1} of ${ids.length}: ${path}`);
			try {
				await this.pullNote(pageId, path, versions.get(pageId), options, resolve, report);
			} catch (error) {
				report.skipped.push({ name: path, reason: errorMessage(error) });
			}
		}

		for (const { page, path, frontmatter } of planned) {
			if (options.signal?.aborted) return { ...report, cancelled: true };
			options.onProgress?.(`Importing ${path}`);
			try {
				await this.writeImport(
					{ page, path, frontmatter },
					options,
					resolve,
					this.imageSkipped(report, path),
				);
				report.imported.push(path);
			} catch (error) {
				report.skipped.push({ name: page.title, reason: errorMessage(error) });
			}
		}
		return report;
	}

	/**
	 * After a publish, record what Confluence now holds as the base for the next pull. Nothing
	 * is downloaded: images uploaded from this vault are matched by name. A page that someone
	 * else saved after the upload keeps its old base, so the next pull merges their edit
	 * instead of taking it as already in the note. Returns the pages whose base couldn't be
	 * saved.
	 */
	async recordPublished(
		pages: readonly PublishedPage[],
		urls: SiteUrls,
	): Promise<{ pageId: string; reason: string }[]> {
		const linked = this.vault.linkedNotes();
		const resolve = createPageLinkResolver(linked, this.vault.notePaths());
		const failures: { pageId: string; reason: string }[] = [];
		for (const { pageId, unchanged, fingerprint } of pages) {
			try {
				const existing = await this.state.get(pageId);
				if (unchanged && existing?.format === MERGE_FORMAT) {
					// Confluence already matches the base; only the note's fingerprint is new.
					if (existing.localFingerprint !== fingerprint)
						await this.state.set({ ...existing, localFingerprint: fingerprint });
					continue;
				}
				const page = await this.remote.getPage(pageId);
				if (!page || page.authorId !== (await this.currentAccountId())) continue;
				const path = linked.get(pageId);
				const sources = path ? [await this.vault.read(path)] : [];
				const converted = await this.convert(page, urls, resolve, sources);
				await this.recordBase(page, converted, fingerprint);
			} catch (error) {
				failures.push({ pageId, reason: errorMessage(error) });
			}
		}
		return failures;
	}

	private async pullNote(
		pageId: string,
		path: string,
		remoteVersion: number | undefined,
		options: PullOptions,
		resolve: PageLinkResolver,
		report: PullReport,
	) {
		const local = await this.vault.read(path);
		if (!options.overwrite && hasConflictMarkers(local)) {
			report.skipped.push({
				name: path,
				reason: "Resolve the conflict markers in this note first.",
			});
			return;
		}
		const base = await this.state.get(pageId);
		// A snapshot in an older format, or with links to pages that now have notes, is
		// converted again even if the page didn't change, so the improvement reaches the note.
		const current =
			base?.format === MERGE_FORMAT &&
			!base.unresolvedLinks.some((id) => resolve(id)) &&
			base.unresolvedMedia.length === 0;
		if (!options.overwrite && base && current && remoteVersion === base.version) {
			report.unchanged++;
			return;
		}
		const page = await this.remote.getPage(pageId);
		if (!page) {
			report.deleted.push(path);
			return;
		}
		if (!options.overwrite && base && current && page.version === base.version) {
			report.unchanged++;
			return;
		}

		// A note that was in sync before the pull stays in sync if the merge is clean. One with
		// local changes keeps its old fingerprint, so the next publish still sends it.
		const wasInSync =
			base?.localFingerprint !== undefined &&
			(await this.vault.fingerprint(path)) === base.localFingerprint;
		const remote = await this.convert(
			page,
			options,
			resolve,
			options.overwrite ? [] : [local, base?.markdown ?? ""],
			this.imageSkipped(report, path),
		);
		const { frontmatter, body } = splitFrontmatter(local);
		if (options.overwrite) {
			// Ignore both local edits and the old baseline, including existing conflict markers.
			// Keep the optimistic write check so edits made during the request aren't lost.
			options.signal?.throwIfAborted();
			await this.vault.replace(path, local, frontmatter + remote.markdown);
			await this.vault.setFrontmatter(path, { [PAGE_TITLE_KEY]: page.title });
			await this.recordBase(page, remote, await this.vault.fingerprint(path));
			report.updated.push(path);
			return;
		}
		let merged;
		if (base) {
			merged = mergeThreeWay(
				body,
				neutralizeLegacyBase(base.markdown, base.format),
				remote.markdown,
			);
		} else if (page.authorId === (await this.currentAccountId())) {
			// Published before pull existed and not edited by anyone else since: Confluence
			// holds our own content, so record it as the base without touching the note. The
			// note may have changed since, so it isn't marked as in sync.
			await this.recordBase(page, remote, undefined);
			report.noHistory.push(path);
			report.unchanged++;
			return;
		} else {
			merged = mergeTwoWay(body, remote.markdown);
		}

		// Only rewrite the note when a line changed, not just its trailing blank lines.
		const changed = !sameLines(merged.text, body);
		if (changed) await this.vault.replace(path, local, frontmatter + merged.text);
		if (base && page.title !== base.title) {
			await this.vault.setFrontmatter(path, { [PAGE_TITLE_KEY]: page.title });
			report.renamed.push({ path, title: page.title });
		}
		const inSync = wasInSync && merged.conflicts === 0;
		await this.recordBase(
			page,
			remote,
			inSync ? await this.vault.fingerprint(path) : base?.localFingerprint,
		);

		if (merged.conflicts > 0) report.conflicted.push(path);
		else if (changed) report.updated.push(path);
		else report.unchanged++;
	}

	/** Walk the page tree under the root and decide where each new page's note will go. */
	private async planImports(
		options: PullOptions,
		pathsById: Map<string, string>,
		report: PullReport,
	): Promise<PlannedImport[]> {
		const { rootPageId } = options.importUnder!;
		const planned: PlannedImport[] = [];
		/** Planned note paths in lower case, because Windows and macOS file names ignore case. */
		const plannedPaths = new Set<string>();
		const visited = new Set<string>([rootPageId]);
		const rootChildren = await this.remote.listChildren(rootPageId);
		const rootFolder = inferRootFolder(rootChildren, pathsById) ?? options.importUnder!.rootFolder;

		type Pending = { children: RemoteChild[]; folder: string | undefined; depth: number };
		const queue: Pending[] = [{ children: rootChildren, folder: rootFolder, depth: 0 }];
		while (queue.length > 0) {
			const { children, folder, depth } = queue.shift()!;
			for (const child of children) {
				options.signal?.throwIfAborted();
				if (visited.has(child.id)) continue;
				visited.add(child.id);
				try {
					const next = await this.planChild(
						child,
						folder,
						pathsById,
						plannedPaths,
						options,
						report,
					);
					if (!next) continue;
					if (next.planned) planned.push(next.planned);
					if (depth < MAX_DEPTH)
						queue.push({ children: next.children, folder: next.folder, depth: depth + 1 });
				} catch (error) {
					report.skipped.push({ name: child.title, reason: errorMessage(error) });
				}
			}
		}
		return planned;
	}

	/** Plan one page's import if needed; returns its children to visit, with their local folder. */
	private async planChild(
		child: RemoteChild,
		folder: string | undefined,
		pathsById: Map<string, string>,
		plannedPaths: Set<string>,
		options: PullOptions,
		report: PullReport,
	): Promise<
		{ children: RemoteChild[]; folder: string | undefined; planned?: PlannedImport } | undefined
	> {
		const linkedPath = pathsById.get(child.id);
		if (linkedPath) {
			const children = await this.remote.listChildren(child.id);
			return { children, folder: isFolderNote(linkedPath) ? parentOf(linkedPath) : undefined };
		}
		if (folder === undefined) {
			report.skipped.push({
				name: child.title,
				reason:
					"Its parent page is a regular note. Move that note into a folder of the same name to import its child pages.",
			});
			return undefined;
		}

		options.onProgress?.(`Checking ${child.title}`);
		const page = await this.remote.getPage(child.id);
		if (!page) return undefined;
		const name = toNoteName(page.title, page.id);
		const children = await this.remote.listChildren(child.id);
		const childFolder = joinPath(folder, name);
		if (isGeneratedFolderPage(page.adf)) return { children, folder: childFolder };

		const path =
			children.length > 0 ? joinPath(childFolder, `${name}.md`) : joinPath(folder, `${name}.md`);
		if (plannedPaths.has(path.toLowerCase()) || (await this.vault.pathInUse(path))) {
			report.skipped.push({
				name: page.title,
				reason: `A note already exists at ${path}. Add ${PAGE_ID_KEY}: ${page.id} to it to link it.`,
			});
			return undefined;
		}
		const frontmatter: Record<string, string> = { [PAGE_ID_KEY]: page.id };
		if (name !== page.title) frontmatter[PAGE_TITLE_KEY] = page.title;
		pathsById.set(page.id, path);
		plannedPaths.add(path.toLowerCase());
		return {
			children,
			folder: children.length > 0 ? childFolder : undefined,
			planned: { page, path, frontmatter },
		};
	}

	/** Bulk and single-page imports share conversion, media handling, and base recording. */
	private async writeImport(
		{ page, path, frontmatter }: PlannedImport,
		urls: SiteUrls,
		resolve: PageLinkResolver,
		onImageError: (error: string) => void,
		signal?: AbortSignal,
	) {
		signal?.throwIfAborted();
		const converted = await this.convert(page, urls, resolve, [], onImageError);
		// Cancellation may arrive during a download; stop before creating the note.
		signal?.throwIfAborted();
		await this.vault.create(path, converted.markdown, frontmatter);
		// Fingerprint the finished note, including frontmatter, so it starts in sync.
		await this.recordBase(page, converted, await this.vault.fingerprint(path));
	}

	/**
	 * Make the page's images local, then convert it. Diagrams rendered from Mermaid blocks in
	 * `sources` (the note and its base) convert back to those blocks. Images are downloaded
	 * only when `onImageError` is given, which receives the failures instead of throwing.
	 */
	private async convert(
		page: RemotePage,
		urls: SiteUrls,
		resolve: PageLinkResolver,
		sources: readonly string[],
		onImageError?: (error: string) => void,
	): Promise<ConvertedPage> {
		const imageErrors = await this.media.ensure(page.adf, {
			download: onImageError !== undefined,
			diagrams: mermaidDiagrams(sources, urls.confluenceBaseUrl),
		});
		for (const error of imageErrors) onImageError?.(error);
		return convertPage(page.adf, urls, resolve, this.media.resolver());
	}

	/** Reports an image that wasn't downloaded against the note. */
	private imageSkipped(report: PullReport, path: string) {
		return (error: string) =>
			report.skipped.push({ name: path, reason: `An image wasn't downloaded: ${error}` });
	}

	private async recordBase(
		page: RemotePage,
		converted: ConvertedPage,
		localFingerprint: string | undefined,
	) {
		await this.state.set({
			pageId: page.id,
			version: page.version,
			title: page.title,
			markdown: converted.markdown,
			format: MERGE_FORMAT,
			unresolvedLinks: converted.unresolvedLinks,
			unresolvedMedia: converted.unresolvedMedia,
			localFingerprint,
		});
	}

	private async currentAccountId() {
		this.accountId ??= await this.remote.currentAccountId();
		return this.accountId;
	}
}

/** The local folder for the root parent page, taken from notes already published under it. */
function inferRootFolder(
	rootChildren: RemoteChild[],
	pathsById: Map<string, string>,
): string | undefined {
	const path = rootChildren.map((child) => pathsById.get(child.id)).find(Boolean);
	if (!path) return undefined;
	return isFolderNote(path) ? parentOf(parentOf(path)) : parentOf(path);
}

/** The publisher's generated folder pages contain only a Page Tree macro. */
export function isGeneratedFolderPage(adf: unknown): boolean {
	const content = (adf as { content?: unknown[] } | undefined)?.content;
	if (!Array.isArray(content) || content.length !== 1) return false;
	const inline = (content[0] as { content?: unknown[] }).content;
	if (!Array.isArray(inline) || inline.length !== 1) return false;
	const node = inline[0] as { type?: string; attrs?: { extensionKey?: string } };
	return node.type === "inlineExtension" && node.attrs?.extensionKey === "pagetree";
}
