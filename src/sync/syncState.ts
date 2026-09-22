import type { DataAdapter } from "obsidian";

/** What Confluence held at the last publish or pull: the merge base for the next pull. */
export interface SyncBase {
	pageId: string;
	version: number;
	title: string;
	/** The page body converted with `adfToMergeMarkdown`. */
	markdown: string;
	/** The `MERGE_FORMAT` that produced `markdown`; 1 for snapshots saved before it existed. */
	format: number;
	/** Pages linked from the content that had no note, so their links stayed web links. */
	unresolvedLinks: string[];
	/** Media file IDs with no local copy, so they stayed `adf` fences. */
	unresolvedMedia: string[];
	/**
	 * The note's fingerprint when it was last in sync with this page, or undefined when it
	 * has local changes that aren't published yet. See `fingerprint.ts`.
	 */
	localFingerprint?: string | undefined;
}

export interface SyncStateStore {
	get(pageId: string): Promise<SyncBase | undefined>;
	set(base: SyncBase): Promise<void>;
	/** Media file ID → vault path of its local copy. */
	getMedia(): Promise<Record<string, string>>;
	setMedia(map: Record<string, string>): Promise<void>;
}

const PAGE_ID = /^\d{1,32}$/;

/**
 * Stores one JSON file per page in the plugin's folder. The Vault API doesn't index the
 * config directory, so the adapter is used. Page IDs are validated before they become
 * file names.
 */
export function createSyncStateStore(adapter: DataAdapter, directory: string): SyncStateStore {
	const pathFor = (pageId: string) => {
		if (!PAGE_ID.test(pageId)) throw new Error(`Invalid Confluence page ID: ${pageId}`);
		return `${directory}/${pageId}.json`;
	};
	/** Parsed JSON from a file in the directory, or undefined if it's missing or unreadable. */
	const readJson = async (path: string): Promise<unknown> => {
		try {
			return JSON.parse(await adapter.read(path)) as unknown;
		} catch {
			return undefined;
		}
	};
	let directoryExists = false;
	const write = async (path: string, value: unknown) => {
		if (!directoryExists && !(await adapter.exists(directory))) await adapter.mkdir(directory);
		directoryExists = true;
		await adapter.write(path, JSON.stringify(value));
	};
	return {
		get: async (pageId) => parseBase(await readJson(pathFor(pageId)), pageId),
		set: (base) => write(pathFor(base.pageId), base),
		getMedia: async () => parseMediaMap(await readJson(`${directory}/media.json`)),
		setMedia: (map) => write(`${directory}/media.json`, map),
	};
}

function parseBase(value: unknown, pageId: string): SyncBase | undefined {
	if (!value || typeof value !== "object") return undefined;
	const { version, title, markdown, format, unresolvedLinks, unresolvedMedia, localFingerprint } =
		value as Record<string, unknown>;
	if (typeof version !== "number" || typeof title !== "string" || typeof markdown !== "string")
		return undefined;
	return {
		pageId,
		version,
		title,
		markdown,
		format: typeof format === "number" ? format : 1,
		unresolvedLinks: stringsOf(unresolvedLinks),
		unresolvedMedia: stringsOf(unresolvedMedia),
		localFingerprint: typeof localFingerprint === "string" ? localFingerprint : undefined,
	};
}

function stringsOf(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

/** Only vault-relative paths without `..` segments are accepted from the stored map. */
function parseMediaMap(value: unknown): Record<string, string> {
	const map: Record<string, string> = {};
	if (!value || typeof value !== "object" || Array.isArray(value)) return map;
	for (const [fileId, path] of Object.entries(value)) {
		if (
			typeof path === "string" &&
			path &&
			!path.startsWith("/") &&
			!path.split("/").includes("..")
		)
			map[fileId] = path;
	}
	return map;
}
