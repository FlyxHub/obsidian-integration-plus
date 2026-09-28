import type { ADFProcessingPlugin } from "@markdown-confluence/lib";

type AdfDoc = Parameters<ADFProcessingPlugin<null, null>["load"]>[0];

const PAGE_PATH = /\/wiki\/spaces\/[^/]+\/pages\/(\d+)/;

/**
 * The lib drops the `~` from personal space keys in smart link URLs, and Confluence stores
 * them with it again, so every publish found the page changed and saved a new version. This
 * puts back the URL of the published note each smart link points to.
 */
export function restoreSmartLinkUrls(
	pageUrls: ReadonlyMap<string, string>,
): ADFProcessingPlugin<null, null> {
	const fix = (node: unknown) => {
		if (typeof node !== "object" || node === null) return;
		const { type, attrs, content } = node as {
			type?: unknown;
			attrs?: { url?: unknown };
			content?: unknown;
		};
		if (type === "inlineCard" && attrs && typeof attrs.url === "string") {
			const pageId = PAGE_PATH.exec(attrs.url)?.[1];
			const url = pageId ? pageUrls.get(pageId) : undefined;
			if (url) attrs.url = url.replace(/\/$/, "");
		}
		if (Array.isArray(content)) content.forEach(fix);
	};
	return {
		extract: () => null,
		transform: () => Promise.resolve(null),
		load: (adf: AdfDoc) => {
			fix(adf);
			return adf;
		},
	};
}

/** Page ID to page URL, from `connie-page-url` values. */
export function pageUrlsById(urls: Iterable<unknown>): Map<string, string> {
	const byId = new Map<string, string>();
	for (const url of urls) {
		if (typeof url !== "string" || !url.startsWith("https://")) continue;
		const pageId = PAGE_PATH.exec(url)?.[1];
		if (pageId) byId.set(pageId, url);
	}
	return byId;
}
