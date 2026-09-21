import { MERGE_FORMAT, adfToMergeMarkdown } from "./adfMarkdown";
import type { ConfluenceRemote, RemoteChild, RemotePage } from "./confluenceRemote";
import { hasConflictMarkers, mergeThreeWay, mergeTwoWay, splitFrontmatter } from "./merge";
import { createPageLinkResolver, rewritePageLinks, type PageLinkResolver } from "./pageLinks";
import type { SyncStateStore } from "./syncState";

/** Vault operations pull needs; implemented with the Obsidian API in main.ts. */
export interface PullVault {
	/** Page ID → vault path, for every note with `connie-page-id`. */
	linkedNotes(): Map<string, string>;
	/** Paths of every Markdown note in the vault, to choose link text like Obsidian does. */
	notePaths(): string[];
	read(path: string): Promise<string>;
	/** Replace the note's text, failing if it changed since `expected` was read. */
	replace(path: string, expected: string, next: string): Promise<void>;
	/** Set frontmatter keys on a note. */
	setFrontmatter(path: string, values: Record<string, string>): Promise<void>;
	exists(path: string): boolean;
	/** Create a note, and any missing parent folders. */
	create(path: string, body: string, frontmatter: Record<string, string>): Promise<void>;
}

export interface PullOptions {
	confluenceBaseUrl: string;
	/** The browser address of the site, which page links in Confluence content point to. */
	confluenceSiteUrl: string;
	/** Pull only these page IDs; all linked notes when undefined. */
	pageIds?: readonly string[];
	/** Import pages under this root page that have no note yet. */
	importUnder?: { rootPageId: string; rootFolder: string };
	signal?: AbortSignal;
	onProgress?: (message: string) => void;
}

export interface PullReport {
	updated: string[];
	conflicted: string[];
	imported: string[];
	renamed: { path: string; title: string }[];
	deleted: string[];
	skipped: { name: string; reason: string }[];
	unchanged: number;
}

export interface ConvertedPage {
	markdown: string;
	/** Linked page IDs that have no note yet. */
	unresolvedLinks: string[];
}

/**
 * Convert a page to the Markdown used for merging and importing: `adfToMergeMarkdown`,
 * then links to pages that have notes become wikilinks. Base and remote must both go
 * through this, with the same resolver, or links show up as changes.
 */
export function convertPage(
	adf: unknown,
	urls: { confluenceBaseUrl: string; confluenceSiteUrl: string },
	resolve: PageLinkResolver,
): ConvertedPage {
	const { markdown, unresolved } = rewritePageLinks(
		adfToMergeMarkdown(adf, urls.confluenceBaseUrl),
		urls.confluenceSiteUrl || urls.confluenceBaseUrl,
		resolve,
	);
	return { markdown, unresolvedLinks: unresolved };
}

interface PlannedImport {
	page: RemotePage;
	path: string;
	frontmatter: Record<string, string>;
}

const FOLDER_NOTE_NAMES = ["index", "README", "readme"];
const MAX_DEPTH = 50;

export class PullService {
	private accountId: string | undefined;

	constructor(
		private readonly remote: ConfluenceRemote,
		private readonly vault: PullVault,
		private readonly state: SyncStateStore,
	) {}

	async pull(options: PullOptions): Promise<PullReport> {
		const report: PullReport = {
			updated: [],
			conflicted: [],
			imported: [],
			renamed: [],
			deleted: [],
			skipped: [],
			unchanged: 0,
		};
		const linked = this.vault.linkedNotes();
		const pathsById = new Map(linked);
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
			options.signal?.throwIfAborted();
			const path = linked.get(pageId);
			if (!path) continue;
			options.onProgress?.(`Pulling ${index + 1} of ${ids.length}: ${path}`);
			try {
				await this.pullNote(pageId, path, versions.get(pageId)?.version, options, resolve, report);
			} catch (error) {
				report.skipped.push({ name: path, reason: messageOf(error) });
			}
		}

		for (const { page, path, frontmatter } of planned) {
			options.signal?.throwIfAborted();
			options.onProgress?.(`Importing ${path}`);
			try {
				const converted = convertPage(page.adf, options, resolve);
				await this.vault.create(path, converted.markdown, frontmatter);
				await this.recordBase(page, converted);
				report.imported.push(path);
			} catch (error) {
				report.skipped.push({ name: page.title, reason: messageOf(error) });
			}
		}
		return report;
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
		if (hasConflictMarkers(local)) {
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
			base?.format === MERGE_FORMAT && !base.unresolvedLinks.some((id) => resolve(id));
		if (base && current && remoteVersion === base.version) {
			report.unchanged++;
			return;
		}
		const page = await this.remote.getPage(pageId);
		if (!page) {
			report.deleted.push(path);
			return;
		}
		if (base && current && page.version === base.version) {
			report.unchanged++;
			return;
		}

		const remote = convertPage(page.adf, options, resolve);
		const { frontmatter, body } = splitFrontmatter(local);
		let merged;
		if (base) {
			merged = mergeThreeWay(body, base.markdown, remote.markdown);
		} else if (page.authorId === (await this.currentAccountId())) {
			// Published before pull existed and not edited by anyone else since: Confluence
			// holds our own content, so record it as the base without touching the note.
			await this.recordBase(page, remote);
			report.unchanged++;
			return;
		} else {
			merged = mergeTwoWay(body, remote.markdown);
		}

		if (merged.text !== body) await this.vault.replace(path, local, frontmatter + merged.text);
		if (base && page.title !== base.title) {
			await this.vault.setFrontmatter(path, { "connie-title": page.title });
			report.renamed.push({ path, title: page.title });
		}
		await this.recordBase(page, remote);

		if (merged.conflicts > 0) report.conflicted.push(path);
		else if (merged.text !== body) report.updated.push(path);
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
					const next = await this.planChild(child, folder, pathsById, plannedPaths, options, report);
					if (!next) continue;
					if (next.planned) planned.push(next.planned);
					if (depth < MAX_DEPTH)
						queue.push({ children: next.children, folder: next.folder, depth: depth + 1 });
				} catch (error) {
					report.skipped.push({ name: child.title, reason: messageOf(error) });
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
		| { children: RemoteChild[]; folder: string | undefined; planned?: PlannedImport }
		| undefined
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
		if (this.vault.exists(path) || plannedPaths.has(path)) {
			report.skipped.push({
				name: page.title,
				reason: `A note already exists at ${path}. Add connie-page-id: ${page.id} to it to link it.`,
			});
			return undefined;
		}
		const frontmatter: Record<string, string> = { "connie-page-id": page.id };
		if (name !== page.title) frontmatter["connie-title"] = page.title;
		pathsById.set(page.id, path);
		plannedPaths.add(path);
		return {
			children,
			folder: children.length > 0 ? childFolder : undefined,
			planned: { page, path, frontmatter },
		};
	}

	private async recordBase(page: RemotePage, converted: ConvertedPage) {
		await this.state.set({
			pageId: page.id,
			version: page.version,
			title: page.title,
			markdown: converted.markdown,
			format: MERGE_FORMAT,
			unresolvedLinks: converted.unresolvedLinks,
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
	for (const child of rootChildren) {
		const path = pathsById.get(child.id);
		if (!path) continue;
		return isFolderNote(path) ? parentOf(parentOf(path)) : parentOf(path);
	}
	return undefined;
}

/** A folder note supplies its folder's page: named like the folder, or index/README. */
export function isFolderNote(path: string): boolean {
	const name = baseName(path).replace(/\.md$/, "");
	const folder = parentOf(path);
	return folder !== "" && (name === baseName(folder) || FOLDER_NOTE_NAMES.includes(name));
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

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Turn a Confluence page title into a safe note name. Titles come from the server, so path
 * separators, characters Obsidian or the OS reject, and leading dots are all removed.
 */
export function toNoteName(title: string, pageId: string): string {
	let name = [...title]
		.map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? "-" : char))
		.join("")
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.slice(0, 180)
		.trim();
	if (RESERVED_WINDOWS_NAMES.test(name)) name = `${name} page`;
	return name || `Untitled ${pageId}`;
}

function joinPath(folder: string, name: string): string {
	return folder ? `${folder}/${name}` : name;
}

function parentOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
