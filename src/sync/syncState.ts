import type { DataAdapter } from "obsidian";

/** What Confluence held at the last publish or pull: the merge base for the next pull. */
export interface SyncBase {
	pageId: string;
	version: number;
	title: string;
	/** The page body converted with `adfToMergeMarkdown`. */
	markdown: string;
}

export interface SyncStateStore {
	get(pageId: string): Promise<SyncBase | undefined>;
	set(base: SyncBase): Promise<void>;
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
	return {
		async get(pageId) {
			const path = pathFor(pageId);
			if (!(await adapter.exists(path))) return undefined;
			try {
				return parseBase(JSON.parse(await adapter.read(path)), pageId);
			} catch {
				return undefined;
			}
		},
		async set(base) {
			const path = pathFor(base.pageId);
			if (!(await adapter.exists(directory))) await adapter.mkdir(directory);
			await adapter.write(path, JSON.stringify(base));
		},
	};
}

function parseBase(value: unknown, pageId: string): SyncBase | undefined {
	if (!value || typeof value !== "object") return undefined;
	const { version, title, markdown } = value as Record<string, unknown>;
	if (typeof version !== "number" || typeof title !== "string" || typeof markdown !== "string")
		return undefined;
	return { pageId, version, title, markdown };
}
