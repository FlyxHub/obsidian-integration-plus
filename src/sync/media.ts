import { createHash } from "node:crypto";
import { getMermaidFileName, parseMarkdownToADF } from "@markdown-confluence/lib";
import { errorMessage } from "../errors";
import { baseName, joinPath } from "../paths";
import { createLinkTextIndex } from "./pageLinks";
import { toNoteName } from "./names";
import type { SyncStateStore } from "./syncState";

export interface RemoteAttachment {
	id: string;
	title: string;
	/** The media file ID that page content uses to refer to this attachment. */
	fileId: string;
	/** The MD5 of the file's content, which the publisher stores as the attachment comment. */
	hash?: string | undefined;
}

export interface MediaRemote {
	listAttachments(pageId: string): Promise<RemoteAttachment[]>;
	downloadAttachment(pageId: string, attachmentId: string): Promise<Uint8Array>;
}

export interface MediaVault {
	/** Every file in the vault, to choose embed text like Obsidian does. */
	filePaths(): string[];
	exists(path: string): boolean;
	/** True when a file or folder has this path, ignoring case where the file system does. */
	pathInUse(path: string): Promise<boolean>;
	readBinary(path: string): Promise<Uint8Array>;
	/** Write a binary file, creating missing folders. */
	writeBinary(path: string, data: Uint8Array): Promise<void>;
}

/** Returns the Markdown for a media file ID, or undefined if it has no local equivalent. */
export type MediaResolver = (fileId: string) => string | undefined;

/** The publisher uploads a local file as `<32-hex hash>-<file name>`. */
const PUBLISHED_ATTACHMENT = /^[0-9a-f]{32}-(.+)$/;

/**
 * File types Obsidian opens as notes, so an embed would show their content as part of the
 * note. Attachments come from whoever can edit the page, so these are never made local.
 */
const NOTE_EXTENSIONS = new Set([".md", ".markdown", ".canvas", ".base"]);

/** True for files without an extension, which links can't tell from notes, and notes. */
function opensAsNote(path: string): boolean {
	const name = baseName(path);
	const dot = name.lastIndexOf(".");
	return dot <= 0 || NOTE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/**
 * Keeps page attachments available as vault files, so pulled notes can embed images as
 * `![[name.png]]` instead of Confluence media references.
 */
export class MediaSync {
	private map: Record<string, string> | undefined;
	private readonly attachments = new Map<string, Promise<RemoteAttachment[]>>();
	/** Media file ID → the Markdown block of a diagram the publisher rendered to that file. */
	private readonly diagrams = new Map<string, string>();
	/** Vault files by name and their link text; rebuilt after this class writes a file. */
	private files: { linkText: (path: string) => string; byName: Map<string, string[]> } | undefined;

	constructor(
		private readonly remote: MediaRemote,
		private readonly vault: MediaVault,
		private readonly store: Pick<SyncStateStore, "getMedia" | "setMedia">,
		private readonly folder: string,
	) {}

	/**
	 * Diagram source blocks, or embeds of files that exist in the vault. Call `ensure` first
	 * for new pages.
	 */
	resolver(): MediaResolver {
		const map = this.map ?? {};
		const { linkText } = this.fileIndex();
		return (fileId) => {
			const diagram = this.diagrams.get(fileId);
			if (diagram) return diagram;
			const path = map[fileId];
			return path && !opensAsNote(path) && this.vault.exists(path)
				? `![[${linkText(path)}]]`
				: undefined;
		};
	}

	/**
	 * Make every file referenced by the page available locally. Files the publisher uploaded
	 * from this vault are matched by name; others are downloaded when `download` is true.
	 * Diagrams the publisher rendered from one of `diagrams`' blocks resolve to that block,
	 * so a note's Mermaid code isn't replaced by its image.
	 * Failures are collected instead of thrown, so one broken image doesn't stop a pull.
	 */
	async ensure(
		adf: unknown,
		/** `diagrams`: attachment title of a rendered diagram → the block it was rendered from. */
		options: { download: boolean; diagrams: ReadonlyMap<string, string> },
	): Promise<string[]> {
		const map = await this.loadMap();
		const { diagrams } = options;
		const errors: string[] = [];
		let changed = false;
		for (const { fileId, pageId } of mediaReferences(adf)) {
			const known = map[fileId];
			const isLocal = !!known && this.vault.exists(known);
			if ((isLocal && diagrams.size === 0) || !pageId) continue;
			try {
				const attachment = (await this.listAttachments(pageId)).find(
					(entry) => entry.fileId === fileId,
				);
				if (!attachment) continue;
				const diagram = diagrams.get(attachment.title);
				if (diagram) {
					this.diagrams.set(fileId, diagram);
					continue;
				}
				if (isLocal) continue;
				const localCopy = await this.publishedCopy(attachment);
				if (localCopy) {
					map[fileId] = localCopy;
					changed = true;
					continue;
				}
				if (!options.download) continue;
				if (opensAsNote(attachment.title)) {
					errors.push(
						`${attachment.title} wasn't downloaded, because Obsidian could open it as a note.`,
					);
					continue;
				}
				const data = await this.remote.downloadAttachment(pageId, attachment.id);
				const path = await this.availablePath(attachment.title, attachment.id);
				await this.vault.writeBinary(path, data);
				this.files = undefined;
				map[fileId] = path;
				changed = true;
			} catch (error) {
				errors.push(errorMessage(error));
			}
		}
		if (changed) await this.store.setMedia(map);
		return errors;
	}

	private async loadMap() {
		this.map ??= await this.store.getMedia();
		return this.map;
	}

	private listAttachments(pageId: string) {
		if (!this.attachments.has(pageId))
			this.attachments.set(pageId, this.remote.listAttachments(pageId));
		return this.attachments.get(pageId)!;
	}

	/**
	 * The vault file the publisher uploaded as this attachment. The name only says which file
	 * to check: anyone who can edit the page can upload an attachment with a matching name, so
	 * the file's content must also match the hash the publisher recorded.
	 */
	private async publishedCopy(attachment: RemoteAttachment): Promise<string | undefined> {
		const name = PUBLISHED_ATTACHMENT.exec(attachment.title)?.[1];
		const path = name && this.findFileNamed(name);
		if (!path || opensAsNote(path) || !attachment.hash) return undefined;
		const hash = createHash("md5")
			.update(await this.vault.readBinary(path))
			.digest("hex");
		return hash === attachment.hash.toLowerCase() ? path : undefined;
	}

	private findFileNamed(name: string): string | undefined {
		const matches = this.fileIndex().byName.get(name);
		return matches?.length === 1 ? matches[0] : undefined;
	}

	private fileIndex() {
		if (!this.files) {
			const paths = this.vault.filePaths();
			const byName = new Map<string, string[]>();
			for (const path of paths) {
				const name = baseName(path);
				byName.set(name, [...(byName.get(name) ?? []), path]);
			}
			this.files = { linkText: createLinkTextIndex(paths), byName };
		}
		return this.files;
	}

	/** A safe, unused path in the image folder, keeping the attachment's file name. */
	private async availablePath(title: string, attachmentId: string): Promise<string> {
		const { name, extension } = safeFileName(title, attachmentId);
		let path = joinPath(this.folder, `${name}${extension}`);
		for (let copy = 1; await this.vault.pathInUse(path); copy++)
			path = joinPath(this.folder, `${name} ${copy}${extension}`);
		return path;
	}
}

/** Attachment titles come from the server: strip path characters and odd extensions. */
export function safeFileName(
	title: string,
	attachmentId: string,
): { name: string; extension: string } {
	const dot = title.lastIndexOf(".");
	const rawExtension = dot > 0 ? title.slice(dot + 1) : "";
	const extension = /^[A-Za-z0-9]{1,10}$/.test(rawExtension)
		? `.${rawExtension.toLowerCase()}`
		: "";
	const base = dot > 0 && extension ? title.slice(0, dot) : title;
	return { name: toNoteName(base, attachmentId), extension };
}

/** Media file references in page content, with the page that holds each attachment. */
export function mediaReferences(adf: unknown): { fileId: string; pageId: string | undefined }[] {
	const references: { fileId: string; pageId: string | undefined }[] = [];
	const visit = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		const { type, attrs, content } = node as {
			type?: unknown;
			attrs?: Record<string, unknown>;
			content?: unknown;
		};
		if ((type === "media" || type === "mediaInline") && attrs?.["type"] === "file") {
			const fileId = attrs["id"];
			const collection = attrs["collection"];
			if (typeof fileId === "string" && fileId)
				references.push({
					fileId,
					pageId:
						typeof collection === "string" ? /^contentId-(\d+)$/.exec(collection)?.[1] : undefined,
				});
		}
		if (Array.isArray(content)) content.forEach(visit);
	};
	visit(adf);
	return references;
}

/**
 * The Mermaid blocks in these Markdown texts, by the attachment title the publisher gives
 * each rendered diagram (`RenderedMermaidChart-<hash>`, as PNG or SVG).
 */
export function mermaidDiagrams(
	texts: readonly string[],
	confluenceBaseUrl: string,
): Map<string, string> {
	const diagrams = new Map<string, string>();
	for (const text of texts) {
		for (const block of parseMarkdownToADF(text, confluenceBaseUrl).content ?? []) {
			const code = block.content?.[0]?.text;
			if (
				block.type !== "codeBlock" ||
				(block.attrs as { language?: unknown } | undefined)?.language !== "mermaid" ||
				!code
			)
				continue;
			for (const format of ["png", "svg"] as const)
				diagrams.set(
					getMermaidFileName(code, format).uploadFilename,
					`\`\`\`mermaid\n${code}\n\`\`\``,
				);
		}
	}
	return diagrams;
}
