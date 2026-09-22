import { errorMessage } from "../errors";
import { baseName } from "../paths";
import { createLinkTextIndex } from "./pageLinks";
import { toNoteName } from "./names";

export interface RemoteAttachment {
	id: string;
	title: string;
	/** The media file ID that page content uses to refer to this attachment. */
	fileId: string;
}

export interface MediaRemote {
	listAttachments(pageId: string): Promise<RemoteAttachment[]>;
	downloadAttachment(pageId: string, attachmentId: string): Promise<Uint8Array>;
}

export interface MediaVault {
	/** Every file in the vault, to choose embed text like Obsidian does. */
	filePaths(): string[];
	exists(path: string): boolean;
	/** Write a binary file, creating missing folders. */
	writeBinary(path: string, data: Uint8Array): Promise<void>;
}

/** Media file ID → vault path of the downloaded or published file. */
export interface MediaMapStore {
	getMedia(): Promise<Record<string, string>>;
	setMedia(map: Record<string, string>): Promise<void>;
}

/** Returns the embed text for a media file ID, or undefined if it has no local file. */
export type MediaResolver = (fileId: string) => string | undefined;

/** The publisher uploads a local file as `<32-hex hash>-<file name>`. */
const PUBLISHED_ATTACHMENT = /^[0-9a-f]{32}-(.+)$/;

/**
 * Keeps page attachments available as vault files, so pulled notes can embed images as
 * `![[name.png]]` instead of Confluence media references.
 */
export class MediaSync {
	private map: Record<string, string> | undefined;
	private readonly attachments = new Map<string, Promise<RemoteAttachment[]>>();
	/** Vault files by name and their link text; rebuilt after this class writes a file. */
	private files: { linkText: (path: string) => string; byName: Map<string, string[]> } | undefined;

	constructor(
		private readonly remote: MediaRemote,
		private readonly vault: MediaVault,
		private readonly store: MediaMapStore,
		private readonly folder: string,
	) {}

	/** Embed text for files that exist in the vault. Call `ensure` first for new pages. */
	resolver(): MediaResolver {
		const map = this.map ?? {};
		const { linkText } = this.fileIndex();
		return (fileId) => {
			const path = map[fileId];
			return path && this.vault.exists(path) ? linkText(path) : undefined;
		};
	}

	/**
	 * Make every file referenced by the page available locally. Files the publisher uploaded
	 * from this vault are matched by name; others are downloaded when `download` is true.
	 * Failures are collected instead of thrown, so one broken image doesn't stop a pull.
	 */
	async ensure(adf: unknown, options: { download: boolean }): Promise<string[]> {
		const map = await this.loadMap();
		const errors: string[] = [];
		let changed = false;
		for (const { fileId, pageId } of mediaReferences(adf)) {
			const known = map[fileId];
			if (known && this.vault.exists(known)) continue;
			if (!pageId) continue;
			try {
				const attachment = (await this.listAttachments(pageId)).find(
					(entry) => entry.fileId === fileId,
				);
				if (!attachment) continue;
				const published = PUBLISHED_ATTACHMENT.exec(attachment.title)?.[1];
				const localCopy = published && this.findFileNamed(published);
				if (localCopy) {
					map[fileId] = localCopy;
					changed = true;
					continue;
				}
				if (!options.download) continue;
				const data = await this.remote.downloadAttachment(pageId, attachment.id);
				const path = this.availablePath(attachment.title, attachment.id);
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
		let pending = this.attachments.get(pageId);
		if (!pending) {
			pending = this.remote.listAttachments(pageId);
			this.attachments.set(pageId, pending);
		}
		return pending;
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
	private availablePath(title: string, attachmentId: string): string {
		const { name, extension } = safeFileName(title, attachmentId);
		const prefix = this.folder ? `${this.folder}/` : "";
		let path = `${prefix}${name}${extension}`;
		for (let copy = 1; this.vault.exists(path); copy++)
			path = `${prefix}${name} ${copy}${extension}`;
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
