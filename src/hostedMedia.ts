import type { ADFProcessingPlugin } from "@markdown-confluence/lib";

type AdfDoc = Parameters<ADFProcessingPlugin<null, null>["load"]>[0];
type MediaAttrs = { type?: unknown; id?: unknown; url?: unknown };

/**
 * Keeps the lib's attachment uploader away from media that Confluence already hosts.
 *
 * A pulled note keeps images it couldn't make local as `adf` blocks, whose media nodes name
 * the attachment by `id` and have no `url`. The uploader collects every file-type media
 * node's `url` and splits it, so an undefined one fails the whole publish. The plugins'
 * `extract` steps run in order on the same document, before the uploader's, so this one
 * gives such nodes an empty `url`, which the uploader skips, and takes it away again in
 * `load`, which also runs before the uploader's and which leaves nodes without a `url` as
 * they are.
 */
export function keepHostedMedia(): ADFProcessingPlugin<null, null> {
	const forEachHostedMedia = (node: unknown, visit: (attrs: MediaAttrs) => void) => {
		if (typeof node !== "object" || node === null) return;
		const { type, attrs, content } = node as {
			type?: unknown;
			attrs?: MediaAttrs;
			content?: unknown;
		};
		if (type === "media" && attrs?.type === "file" && typeof attrs.id === "string" && attrs.id)
			visit(attrs);
		if (Array.isArray(content)) for (const child of content) forEachHostedMedia(child, visit);
	};
	return {
		extract: (adf) => {
			forEachHostedMedia(adf, (attrs) => {
				if (attrs.url === undefined) attrs.url = "";
			});
			return null;
		},
		transform: () => Promise.resolve(null),
		load: (adf: AdfDoc) => {
			forEachHostedMedia(adf, (attrs) => {
				if (attrs.url === "") delete attrs.url;
			});
			return adf;
		},
	};
}
