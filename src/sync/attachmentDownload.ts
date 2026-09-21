import { request } from "node:https";
import type { ConfluenceFetch, RequiredConfluenceClient } from "@markdown-confluence/lib";

/** Largest attachment pull will download. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_MEDIA_REDIRECTS = 3;
const DOWNLOAD_PATH = /\/wiki\/rest\/api\/content\/\d+\/child\/attachment\/[^/]+\/download$/;

interface RawResponse {
	status: number;
	location: string | undefined;
	body: Uint8Array;
}

type Captured = { bytes: Uint8Array } | { location: string };

/**
 * Downloads Confluence attachments.
 *
 * Confluence Cloud answers an attachment download with a redirect to Atlassian's media
 * service, and the regular transport refuses redirects so credentials are never forwarded.
 * This wraps the transport's fetch: for download requests only, it records the redirect
 * (or the bytes, if Confluence answers directly) instead of failing. The file is then
 * fetched from the redirect target without any credentials, and only from Atlassian hosts.
 */
export function createAttachmentDownloader(baseFetch: ConfluenceFetch) {
	const captured = new Map<string, Captured>();

	const fetch: ConfluenceFetch = async (url, init) => {
		if (!DOWNLOAD_PATH.test(new URL(url).pathname)) return baseFetch(url, init);
		const response = await rawRequest(url, headersOf(init.headers), init.signal ?? undefined);
		if (response.status >= 300 && response.status < 400 && response.location) {
			captured.set(url, { location: new URL(response.location, url).href });
			return jsonResponse(200);
		}
		if (response.status >= 200 && response.status < 300) {
			captured.set(url, { bytes: response.body });
			return jsonResponse(200);
		}
		return jsonResponse(response.status);
	};

	async function download(
		client: RequiredConfluenceClient,
		pageId: string,
		attachmentId: string,
		signal?: AbortSignal,
	): Promise<Uint8Array> {
		const path = `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(attachmentId)}/download`;
		await client.sendRequest({ method: "GET", url: path });
		const key = [...captured.keys()].find((url) => new URL(url).pathname.endsWith(path));
		const result = key ? captured.get(key) : undefined;
		if (key) captured.delete(key);
		if (!result) throw new Error("Confluence didn't return the attachment.");
		return "bytes" in result ? result.bytes : fetchMedia(result.location, signal);
	}

	return { fetch, download };
}

/** Follow the media service's redirects without credentials, only to Atlassian hosts. */
async function fetchMedia(location: string, signal?: AbortSignal): Promise<Uint8Array> {
	let url = location;
	for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop++) {
		assertAtlassianMediaUrl(url);
		const response = await rawRequest(url, {}, signal);
		if (response.status >= 300 && response.status < 400 && response.location) {
			url = new URL(response.location, url).href;
			continue;
		}
		if (response.status >= 200 && response.status < 300) return response.body;
		throw new Error(`The attachment download failed with HTTP ${response.status}.`);
	}
	throw new Error("The attachment download was redirected too many times.");
}

/** Attachment content is served from Atlassian's own domains over HTTPS. */
export function assertAtlassianMediaUrl(value: string): void {
	const url = new URL(value);
	const host = url.hostname.toLowerCase();
	const atlassian =
		host === "atlassian.com" ||
		host.endsWith(".atlassian.com") ||
		host === "atlassian.net" ||
		host.endsWith(".atlassian.net");
	if (url.protocol !== "https:" || url.username || url.password || !atlassian)
		throw new Error(`The attachment download was redirected to an unexpected address: ${host}`);
}

function rawRequest(
	url: string,
	headers: Record<string, string>,
	signal: AbortSignal | undefined,
): Promise<RawResponse> {
	if (new URL(url).protocol !== "https:") throw new Error("Attachment downloads require HTTPS");
	return new Promise((resolve, reject) => {
		const outgoing = request(
			url,
			{ method: "GET", headers, ...(signal ? { signal } : {}) },
			(incoming) => {
				const status = incoming.statusCode ?? 0;
				const location = incoming.headers.location;
				if (status >= 300 && status < 400) {
					incoming.destroy();
					resolve({ status, location, body: new Uint8Array() });
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				incoming.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > MAX_ATTACHMENT_BYTES) {
						incoming.destroy();
						reject(new Error("The attachment is larger than 100 MB."));
						return;
					}
					chunks.push(chunk);
				});
				incoming.on("error", reject);
				incoming.on("end", () =>
					resolve({ status, location, body: Uint8Array.from(Buffer.concat(chunks)) }),
				);
			},
		);
		outgoing.on("error", reject);
		outgoing.end();
	});
}

function headersOf(headers: RequestInit["headers"]): Record<string, string> {
	return Object.fromEntries(new Headers(headers));
}

function jsonResponse(status: number) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: "",
		headers: new Headers(),
		text: async () => "{}",
		json: async () => ({}) as unknown,
	};
}
