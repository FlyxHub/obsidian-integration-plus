import {
	convertADFToMarkdown,
	parseMarkdownToADF,
	readAdfDocument,
} from "@markdown-confluence/lib";
import { normalizeCalloutsForPublish } from "../callouts";
import type { MediaResolver } from "./media";

type AdfNode = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };

/** Attributes Confluence's editor adds that carry no content and are regenerated on publish. */
const PRESENTATION_ATTRS: Record<string, (value: unknown) => boolean> = {
	localId: () => true,
	colwidth: () => true,
	colspan: (value) => value === 1,
	rowspan: (value) => value === 1,
	layout: (value) => value === "default" || value === "center",
	isNumberColumnEnabled: (value) => value === false,
	width: () => true,
	displayMode: (value) => value === "default",
	__autoSize: () => true,
};

/**
 * Convert Confluence ADF to Markdown that is stable enough to diff and merge.
 *
 * Each top-level block is converted on its own. A block uses readable Markdown when that
 * Markdown parses back to the same content, ignoring editor-only attributes such as
 * `localId`. Otherwise it is kept as an `adf` fence, which the publisher restores exactly,
 * so Confluence-only content such as statuses and attachments survives a round trip.
 */
export function adfToMergeMarkdown(
	input: unknown,
	confluenceBaseUrl: string,
	media: MediaResolver = () => undefined,
): string {
	const document = readAdfDocument(input) as { content?: unknown[] };
	return joinBlocks(document.content ?? [], confluenceBaseUrl, media) + "\n";
}

/** Convert blocks and separate them with blank lines, leaving out empty ones. */
function joinBlocks(content: unknown[], confluenceBaseUrl: string, media: MediaResolver): string {
	return content
		.filter(isNode)
		.map((block) => blockToMarkdown(block, confluenceBaseUrl, media))
		.filter((markdown) => markdown !== "")
		.join("\n\n");
}

/**
 * Version of `adfToMergeMarkdown`'s output. Bump it whenever the output for the same ADF
 * changes: snapshots from an older version are converted again on the next pull, and the
 * difference is merged into notes as a formatting update.
 * 1: initial. 2: panels as callouts. 3: links to pages with notes as wikilinks.
 * 4: images as embeds of downloaded files; empty paragraphs left out.
 * 5: rendered Mermaid diagrams as their source blocks.
 */
export const MERGE_FORMAT = 5;

/** Confluence panel types and the Obsidian callout type that publishes back to each. */
const PANEL_CALLOUTS: Record<string, string> = {
	info: "info",
	note: "note",
	warning: "warning",
	success: "success",
	error: "failure",
};

function blockToMarkdown(block: AdfNode, confluenceBaseUrl: string, media: MediaResolver): string {
	// Confluence adds empty paragraphs, often at the end of a page; they carry no content.
	if (block.type === "paragraph" && (block.content ?? []).length === 0) return "";
	const embeds = mediaEmbeds(block, media);
	if (embeds) return embeds;
	if (block.type === "panel") {
		const callout = panelToCallout(block, confluenceBaseUrl, media);
		if (callout && publishesAs(callout, block, confluenceBaseUrl)) return callout;
	}
	const readable = convertADFToMarkdown(asDocument(block), { lossless: false }).trim();
	if (readable && !readable.startsWith("```adf")) {
		if (publishesAs(readable, block, confluenceBaseUrl))
			return neutralizeExecutableMarkdown(readable);
	}
	return neutralizeExecutableMarkdown(
		convertADFToMarkdown(asDocument(stripPresentation(block)), { lossless: true }).trim(),
	);
}

/**
 * A Confluence panel as an Obsidian callout without a title. The lib's own conversion runs
 * the panel's blocks together, so each block is converted here and separated by a quoted
 * blank line. Custom panels, with their own icon and color, have no callout equivalent.
 */
function panelToCallout(
	panel: AdfNode,
	confluenceBaseUrl: string,
	media: MediaResolver,
): string | undefined {
	const { panelType, ...otherAttrs } = stripPresentation({ attrs: panel.attrs }).attrs ?? {};
	const calloutType = PANEL_CALLOUTS[String(panelType)];
	if (!calloutType || Object.keys(otherAttrs).length > 0) return undefined;
	const inner = joinBlocks(panel.content ?? [], confluenceBaseUrl, media);
	if (inner === "") return undefined;
	const body = inner
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
	return `> [!${calloutType}]\n${body}`;
}

/**
 * Images and files as Obsidian embeds of their downloaded copies, and rendered diagrams as
 * their source. Publishing uploads or renders them again, so these blocks skip the
 * round-trip check: the media ID changes, but the page shows the same image. Returns
 * undefined unless every file in the block resolves.
 */
function mediaEmbeds(block: AdfNode, media: MediaResolver): string | undefined {
	if (block.type !== "mediaSingle" && block.type !== "mediaGroup") return undefined;
	const items = (block.content ?? []).filter(isNode);
	if (items.length === 0 || items.some((item) => item.type !== "media")) return undefined;
	const embeds = items.map((item) => {
		const fileId = item.attrs?.["id"];
		return item.attrs?.["type"] === "file" && typeof fileId === "string"
			? media(fileId)
			: undefined;
	});
	return embeds.every((embed) => embed !== undefined) ? embeds.join("\n") : undefined;
}

/** True when publishing the Markdown recreates the block, ignoring editor-only attributes. */
function publishesAs(markdown: string, block: AdfNode, confluenceBaseUrl: string): boolean {
	const published = parseMarkdownToADF(normalizeCalloutsForPublish(markdown), confluenceBaseUrl);
	return sameContent(published.content ?? [], [block]);
}

/**
 * Code block languages that Obsidian plugins run as JavaScript when a note is viewed.
 * Anyone who can edit the Confluence page controls pulled content, so it must not arrive
 * as code that runs in the vault.
 */
const EXECUTABLE_LANGUAGES = new Set([
	"dataviewjs",
	"js-engine",
	"js-engine-debug",
	"meta-bind-js-view",
]);

/**
 * Make pulled content inert: executable code blocks become plain `text` blocks, and Dataview
 * inline JavaScript (`` `$= ...` ``) gets a space so it no longer runs. Notes you wrote keep
 * their own blocks, because the merge keeps local text that Confluence didn't change.
 */
export function neutralizeExecutableMarkdown(markdown: string): string {
	return markdown
		.replace(
			/^(\s*)(`{3,}|~{3,})[ \t]*([\w-]+)/gm,
			(match, indent: string, fence: string, language: string) =>
				EXECUTABLE_LANGUAGES.has(language.toLowerCase()) ? `${indent}${fence}text` : match,
		)
		.replace(/`\$=/g, "`$ =");
}

/** True when two ADF fragments differ only in editor-only presentation attributes. */
export function sameContent(left: unknown, right: unknown): boolean {
	return JSON.stringify(stripPresentation(left)) === JSON.stringify(stripPresentation(right));
}

/** Remove editor-only attributes, and empty `attrs`/`marks`, so fragments compare by content. */
function stripPresentation<T>(value: T): T {
	if (Array.isArray(value)) return value.map(stripPresentation) as T;
	if (!value || typeof value !== "object") return value;
	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (key === "attrs" && child && typeof child === "object" && !Array.isArray(child)) {
			const attrs: Record<string, unknown> = {};
			for (const [name, attr] of Object.entries(child as Record<string, unknown>)) {
				if (!PRESENTATION_ATTRS[name]?.(attr)) attrs[name] = stripPresentation(attr);
			}
			if (Object.keys(attrs).length > 0) result[key] = sortKeys(attrs);
			continue;
		}
		if (key === "marks" && Array.isArray(child) && child.length === 0) continue;
		result[key] = stripPresentation(child);
	}
	return sortKeys(result) as T;
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function asDocument(block: AdfNode) {
	return { type: "doc", version: 1, content: [block] };
}

function isNode(value: unknown): value is AdfNode {
	return (
		!!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
	);
}
