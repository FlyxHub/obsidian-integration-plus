import type { ConfluenceFetch, RequiredConfluenceClient } from "@markdown-confluence/lib";
import { isRedirect, nodeRequest } from "../nodeRequest";

/** Largest attachment pull will download. */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_MEDIA_REDIRECTS = 3;
const DOWNLOAD_PATH = /\/wiki\/rest\/api\/content\/\d+\/child\/attachment\/[^/]+\/download$/;

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
		const response = await nodeRequest(url, {
			headers: Object.fromEntries(new Headers(init.headers)),
			signal: init.signal,
			maxBytes: MAX_ATTACHMENT_BYTES,
		});
		if (isRedirect(response.status) && response.location) {
			captured.set(url, { location: new URL(response.location, url).href });
			return jsonResponse(200);
		}
		if (response.status >= 200 && response.status < 300) {
			captured.set(url, { bytes: response.body });
			return jsonResponse(200);
		}
		return jsonResponse(response.status);
	};

	async function downloadAttachment(
		client: RequiredConfluenceClient,
		pageId: string,
		attachmentId: string,
	): Promise<Uint8Array> {
		const path = `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(attachmentId)}/download`;
		await client.sendRequest({ method: "GET", url: path });
		const key = [...captured.keys()].find((url) => new URL(url).pathname.endsWith(path));
		const result = key ? captured.get(key) : undefined;
		if (key) captured.delete(key);
		if (!result) throw new Error("Confluence didn't return the attachment.");
		return "bytes" in result ? result.bytes : fetchMedia(result.location);
	}

	return { fetch, download: downloadAttachment };
}

/** Follow the media service's redirects without credentials, only to Atlassian hosts. */
async function fetchMedia(location: string): Promise<Uint8Array> {
	let url = location;
	for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop++) {
		assertAtlassianMediaUrl(url);
		const response = await nodeRequest(url, { maxBytes: MAX_ATTACHMENT_BYTES });
		if (isRedirect(response.status) && response.location) {
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
