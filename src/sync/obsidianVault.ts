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
	const stamp = (link: string, embedded: TFile | null) =>
		embedded
			? `embed:${embedded.path}:${embedded.stat.mtime}:${embedded.stat.size}`
			: `embed:${link}:missing`;
	return async (path) => {
		const file = app.vault.getFileByPath(normalizePath(path));
		if (!file) return undefined;
		const text = await app.vault.read(file);
		if (hasLiveQueries(text, settings)) return undefined;
		const { embeds, links } = noteReferences(text);
		const target = (link: string, source: TFile) =>
			app.metadataCache.getFirstLinkpathDest(link, source.path);
		const dependencies = [
			...embeds.map((link) => stamp(link, target(link, file))),
			...links.map((link) => {
				const linked = target(link, file);
				return `link:${link}:${linked?.path ?? ""}:${linked ? (linkedPageId(app, linked) ?? "") : ""}`;
			}),
		];
		// The publisher copies embedded notes into the page with their own embeds, so files
		// those embed count too, and a Dataview query in one makes the note always publish.
		const visited = new Set([file.path]);
		const pending = embeds.map((link) => ({ embedded: target(link, file), depth: 1 }));
		for (let next = pending.shift(); next; next = pending.shift()) {
			const { embedded, depth } = next;
			if (embedded?.extension !== "md" || visited.has(embedded.path)) continue;
			visited.add(embedded.path);
			const embeddedText = await app.vault.cachedRead(embedded);
			if (hasLiveQueries(embeddedText, settings)) return undefined;
			if (depth >= MAX_EMBED_DEPTH) continue;
			for (const link of noteReferences(embeddedText).embeds) {
				const nested = target(link, embedded);
				dependencies.push(stamp(link, nested));
				pending.push({ embedded: nested, depth: depth + 1 });
			}
		}
		return fingerprintNote({ path: file.path, text, dependencies, settings: settingsKey });
	};
}

/** How deep the publisher follows notes embedded in embedded notes. */
const MAX_EMBED_DEPTH = 50;

export function createObsidianPullVault(
	app: App,
	fingerprint: NoteFingerprinter,
): PullVault & MediaVault {
	const fileAt = (path: string) => {
		const file = app.vault.getFileByPath(normalizePath(path));
		if (!file) throw new Error(`Note not found: ${path}`);
		return file;
	};

	const assignFrontmatter = (file: TFile, values: Record<string, string | boolean>) =>
		app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			Object.assign(frontmatter, values);
		});

	const ensureFolder = async (path: string) => {
		if (!path) return;
		const existing = app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		if (existing) throw new Error(`${path} exists and is not a folder.`);
		await ensureFolder(parentOf(path));
		await app.vault.createFolder(path);
	};

	const notesByPage = () => {
		const notes = new Map<string, string[]>();
		for (const file of app.vault.getMarkdownFiles()) {
			const pageId = linkedPageId(app, file);
			if (pageId) notes.set(pageId, [...(notes.get(pageId) ?? []), file.path]);
		}
		return notes;
	};

	return {
		linkedNotes: () => new Map([...notesByPage()].map(([pageId, paths]) => [pageId, paths[0]!])),

		duplicateLinks: () =>
			[...notesByPage()]
				.filter(([, paths]) => paths.length > 1)
				.map(([pageId, paths]) => ({ pageId, paths })),

		notePaths: () => app.vault.getMarkdownFiles().map((file) => file.path),

		filePaths: () => app.vault.getFiles().map((file) => file.path),

		readBinary: async (path) => new Uint8Array(await app.vault.readBinary(fileAt(path))),

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

		setFrontmatter: (path, values) => assignFrontmatter(fileAt(path), values),

		exists: (path) => app.vault.getAbstractFileByPath(normalizePath(path)) !== null,

		// The vault compares paths by case, but Windows and macOS file names don't, so ask the
		// file system: writing `design.md` next to `Design.md` would replace it there.
		pathInUse: async (path) =>
			app.vault.getAbstractFileByPath(normalizePath(path)) !== null ||
			(await app.vault.adapter.exists(normalizePath(path))),

		fingerprint,

		async create(path, body, frontmatter) {
			const notePath = normalizePath(path);
			await ensureFolder(parentOf(notePath));
			// A body that starts with `---` would be read as frontmatter.
			const text = body.startsWith("---") ? `\n${body}` : body;
			// Pulled content is written under another extension and then renamed, so plugins that
			// run commands in new notes, such as Templater, never run it.
			const file = await app.vault.create(`${notePath}.${crypto.randomUUID()}.tmp`, text);
			try {
				await app.vault.rename(file, notePath);
				await assignFrontmatter(file, frontmatter);
			} catch (error) {
				// Don't leave a half-made note behind; the page is imported again next time.
				await app.fileManager.trashFile(file).catch(() => undefined);
				throw error;
			}
		},
	};
}
