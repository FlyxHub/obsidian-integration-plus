import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { PullVault } from "./pull";

export const PAGE_ID_KEY = "connie-page-id";

/** The page ID a note is linked to, from its `connie-page-id` frontmatter. */
export function linkedPageId(app: App, file: TFile): string | undefined {
	const value: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[PAGE_ID_KEY];
	if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
	return typeof value === "string" && /^\d+$/.test(value.trim()) ? value.trim() : undefined;
}

export function createObsidianPullVault(app: App): PullVault {
	const fileAt = (path: string) => {
		const file = app.vault.getFileByPath(normalizePath(path));
		if (!file) throw new Error(`Note not found: ${path}`);
		return file;
	};

	const ensureFolder = async (path: string) => {
		if (!path) return;
		const existing = app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		if (existing) throw new Error(`${path} exists and is not a folder.`);
		await ensureFolder(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
		await app.vault.createFolder(path);
	};

	return {
		linkedNotes() {
			const notes = new Map<string, string>();
			for (const file of app.vault.getMarkdownFiles()) {
				const pageId = linkedPageId(app, file);
				if (pageId && !notes.has(pageId)) notes.set(pageId, file.path);
			}
			return notes;
		},

		read: (path) => app.vault.read(fileAt(path)),

		async replace(path, expected, next) {
			await app.vault.process(fileAt(path), (current) => {
				if (current !== expected) throw new Error("The note changed while pulling. Pull it again.");
				return next;
			});
		},

		async setFrontmatter(path, values) {
			await app.fileManager.processFrontMatter(
				fileAt(path),
				(frontmatter: Record<string, unknown>) => {
					Object.assign(frontmatter, values);
				},
			);
		},

		exists: (path) => app.vault.getAbstractFileByPath(normalizePath(path)) !== null,

		async create(path, body, frontmatter) {
			const notePath = normalizePath(path);
			await ensureFolder(notePath.slice(0, Math.max(0, notePath.lastIndexOf("/"))));
			const file = await app.vault.create(notePath, body);
			if (!(file instanceof TFile)) throw new Error(`Could not create ${notePath}.`);
			await app.fileManager.processFrontMatter(file, (values: Record<string, unknown>) => {
				Object.assign(values, frontmatter);
			});
		},
	};
}
