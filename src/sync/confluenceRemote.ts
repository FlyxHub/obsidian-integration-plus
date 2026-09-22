import type { RequiredConfluenceClient } from "@markdown-confluence/lib";
import type { MediaRemote } from "./media";

export interface RemotePage {
	id: string;
	title: string;
	version: number;
	authorId: string;
	adf: unknown;
}

export interface RemoteVersion {
	version: number;
}

export interface RemoteChild {
	id: string;
	title: string;
}

/** Read-only Confluence calls used by pull and by the pre-publish check. */
export interface ConfluenceRemote {
	currentAccountId(): Promise<string>;
	/** The page with its ADF body, or undefined if it no longer exists. */
	getPage(id: string): Promise<RemotePage | undefined>;
	/** Current versions for existing pages; deleted or inaccessible pages are left out. */
	getVersions(ids: readonly string[]): Promise<Map<string, RemoteVersion>>;
	listChildren(id: string): Promise<RemoteChild[]>;
}

const BATCH_SIZE = 250;

/** Downloads attachment bytes; see `createAttachmentDownloader`. */
export type AttachmentDownload = (
	client: RequiredConfluenceClient,
	pageId: string,
	attachmentId: string,
) => Promise<Uint8Array>;

export function createConfluenceRemote(
	client: RequiredConfluenceClient,
	download?: AttachmentDownload,
): ConfluenceRemote & MediaRemote {
	return {
		async listAttachments(pageId) {
			const response = await client.contentAttachments.getAttachments({ id: pageId });
			return response.results.map((attachment) => ({
				id: attachment.id,
				title: attachment.title,
				fileId: attachment.extensions.fileId,
			}));
		},

		async downloadAttachment(pageId, attachmentId) {
			if (!download) throw new Error("Attachment downloads aren't available here.");
			return download(client, pageId, attachmentId);
		},

		async currentAccountId() {
			return (await client.users.getCurrentUser()).accountId;
		},

		async getPage(id) {
			let page;
			try {
				page = await client.content.getContentById({
					id,
					expand: ["body.atlas_doc_format", "version"],
				});
			} catch (error) {
				if (statusOf(error) === 404) return undefined;
				throw error;
			}
			const body = page.body?.atlas_doc_format?.value;
			if (!body) throw new Error(`Confluence returned no content for page ${id}.`);
			return {
				id: page.id,
				title: page.title,
				version: page.version?.number ?? 0,
				authorId: page.version?.by?.accountId ?? "",
				adf: JSON.parse(body) as unknown,
			};
		},

		async getVersions(ids) {
			const versions = new Map<string, RemoteVersion>();
			for (let start = 0; start < ids.length; start += BATCH_SIZE) {
				const batch = ids.slice(start, start + BATCH_SIZE);
				const response = await client.sendRequest<unknown>({
					method: "GET",
					url: "/wiki/api/v2/pages",
					searchParams: { id: batch.join(","), limit: BATCH_SIZE },
				});
				for (const entry of resultsOf(response)) {
					const version = recordOf(entry["version"]);
					if (typeof entry["id"] !== "string" || typeof version["number"] !== "number") continue;
					versions.set(entry["id"], { version: version["number"] });
				}
			}
			return versions;
		},

		async listChildren(id) {
			const children: RemoteChild[] = [];
			const seen = new Set<string>();
			let cursor: string | undefined;
			for (;;) {
				const response = await client.sendRequest<unknown>({
					method: "GET",
					url: `/wiki/api/v2/pages/${encodeURIComponent(id)}/children`,
					searchParams: { limit: BATCH_SIZE, ...(cursor ? { cursor } : {}) },
				});
				for (const entry of resultsOf(response)) {
					if (typeof entry["id"] === "string" && typeof entry["title"] === "string")
						children.push({ id: entry["id"], title: entry["title"] });
				}
				const next = recordOf(recordOf(response)["_links"])["next"];
				if (typeof next !== "string") return children;
				const nextCursor = new URL(next, "https://confluence.invalid").searchParams.get("cursor");
				if (!nextCursor || seen.has(nextCursor))
					throw new Error("Confluence child page pagination did not advance.");
				seen.add(nextCursor);
				cursor = nextCursor;
			}
		},
	};
}

function resultsOf(response: unknown): Record<string, unknown>[] {
	const results = recordOf(response)["results"];
	return Array.isArray(results) ? results.map(recordOf) : [];
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function statusOf(error: unknown): number | undefined {
	const status = recordOf(recordOf(error)["response"])["status"];
	return typeof status === "number" ? status : undefined;
}
