import { App, TFile, TFolder, normalizePath } from "obsidian";
import { PAGE_ID_KEY } from "../frontmatterKeys";
import { parentOf } from "../paths";
import type { ObsidianPluginSettings } from "../settings";
import { fingerprintNote, hasLiveQueries, noteReferences, publishSettingsKey } from "./fingerprint";
import type { MediaVault } from "./media";
import type { NoteFingerprinter } from "./publishGate";
import type { PullVault } from "./pull";

/** The page ID a note is linked to, from its `connie-page-id` frontmatter. */
export function linkedPageId(app: App, file: TFile): string | undefined {
	const value: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[PAGE_ID_KEY];
	if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
	return typeof value === "string" && /^\d+$/.test(value.trim()) ? value.trim() : undefined;
}

/**
 * Fingerprints notes as they are now. Embedded files count by modification time and size,
 * and linked notes by the page they're published to, because both change the published page.
 */
export function createNoteFingerprinter(
	app: App,
	settings: ObsidianPluginSettings,
): NoteFingerprinter {
	const settingsKey = publishSettingsKey(settings);
	return async (path) => {
		const file = app.vault.getFileByPath(normalizePath(path));
		if (!file) return undefined;
		const text = await app.vault.read(file);
		if (hasLiveQueries(text, settings)) return undefined;
		const { embeds, links } = noteReferences(text);
		const target = (link: string) => app.metadataCache.getFirstLinkpathDest(link, file.path);
		const dependencies = [
			...embeds.map((link) => {
				const embedded = target(link);
				return embedded
					? `embed:${embedded.path}:${embedded.stat.mtime}:${embedded.stat.size}`
					: `embed:${link}:missing`;
			}),
			...links.map((link) => {
				const linked = target(link);
				return `link:${link}:${linked?.path ?? ""}:${linked ? (linkedPageId(app, linked) ?? "") : ""}`;
			}),
		];
		return fingerprintNote({ path: file.path, text, dependencies, settings: settingsKey });
	};
}

export function createObsidianPullVault(
	app: App,
	fingerprint: NoteFingerprinter,
): PullVault & MediaVault {
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
		await ensureFolder(parentOf(path));
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

		notePaths: () => app.vault.getMarkdownFiles().map((file) => file.path),

		filePaths: () => app.vault.getFiles().map((file) => file.path),

		async writeBinary(path, data) {
			const filePath = normalizePath(path);
			await ensureFolder(parentOf(filePath));
			await app.vault.createBinary(filePath, Uint8Array.from(data).buffer);
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

		fingerprint,

		async create(path, body, frontmatter) {
			const notePath = normalizePath(path);
			await ensureFolder(parentOf(notePath));
			const file = await app.vault.create(notePath, body);
			if (!(file instanceof TFile)) throw new Error(`Could not create ${notePath}.`);
			await app.fileManager.processFrontMatter(file, (values: Record<string, unknown>) => {
				Object.assign(values, frontmatter);
			});
		},
	};
}
