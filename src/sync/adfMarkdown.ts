import "../markdownIt";
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
	// Smart link details Confluence's editor caches, such as the linked page's title.
	__confluenceMetadata: () => true,
};

/** Marks Markdown writes around text, which can't start or end inside them with a space. */
const EMPHASIS_MARKS = new Set(["strong", "em", "strike"]);

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
	const document = tidyText(neutralizeExecutableAdf(readAdfDocument(input))) as {
		content?: unknown[];
	};
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
 * 6: line breaks at the end of a paragraph ignored.
 * 7: spaces next to a line break ignored, so such paragraphs are readable Markdown.
 * 8: executable code made inert in the ADF, so it's caught inside quotes, lists and panels,
 *    and `dataview` queries too; code inside other code blocks is left as it is.
 * 9: blocks readable that Markdown can represent once compared like the publisher writes
 *    them: smart links to pages in personal spaces (`/spaces/~...`), bold or italic text
 *    with a space at an end, marks in another order, and line breaks at a paragraph's start.
 */
export const MERGE_FORMAT = 9;

/** The first format that neutralizes code in the ADF; see `neutralizeLegacyBase`. */
const ADF_NEUTRALIZED_FORMAT = 8;

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
	if (block.type === "paragraph" && trimLineBreaks(block.content ?? []).length === 0) return "";
	const embeds = mediaEmbeds(block, media);
	if (embeds) return embeds;
	if (block.type === "panel") {
		const callout = panelToCallout(block, confluenceBaseUrl, media);
		if (callout && publishesAs(callout, block, confluenceBaseUrl)) return callout;
	}
	const readable = convertADFToMarkdown(asDocument(block), { lossless: false }).trim();
	if (readable && !readable.startsWith("```adf") && publishesAs(readable, block, confluenceBaseUrl))
		return readable;
	return convertADFToMarkdown(asDocument(stripPresentation(block)), { lossless: true }).trim();
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
 * Code block languages that Obsidian plugins run as JavaScript when a note is viewed, and
 * Dataview queries, which read the whole vault and are published as their results.
 * Anyone who can edit the Confluence page controls pulled content, so it must not arrive
 * as code that runs in the vault.
 */
const EXECUTABLE_LANGUAGES = new Set([
	"dataview",
	"dataviewjs",
	"js-engine",
	"js-engine-debug",
	"meta-bind-js-view",
]);

/** Dataview inline JavaScript: inline code starting with `$=`. */
const INLINE_JS = /^(\s*)\$=/;

/**
 * Make pulled content inert, wherever it is in the page: executable code blocks become plain
 * `text` blocks, and Dataview inline JavaScript (`` `$= ...` ``) gets a space so it no longer
 * runs. Notes you wrote keep their own blocks, because the merge keeps local text that
 * Confluence didn't change.
 */
function neutralizeExecutableAdf(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(neutralizeExecutableAdf);
	if (!isNode(node)) return node;
	const result: AdfNode & { text?: unknown; marks?: unknown } = { ...node };
	const language = node.attrs?.["language"];
	if (
		node.type === "codeBlock" &&
		typeof language === "string" &&
		EXECUTABLE_LANGUAGES.has(language.toLowerCase())
	)
		result.attrs = { ...node.attrs, language: "text" };
	if (
		node.type === "text" &&
		typeof result.text === "string" &&
		Array.isArray(result.marks) &&
		result.marks.some((mark) => (mark as { type?: unknown })?.type === "code")
	)
		result.text = result.text.replace(INLINE_JS, "$1$ =");
	if (node.content) result.content = node.content.map(neutralizeExecutableAdf);
	return result;
}

/**
 * Snapshots older than `ADF_NEUTRALIZED_FORMAT` made code inert in the Markdown, and missed
 * it inside quotes, lists and callouts. Applying the same rule to such a base before merging
 * keeps a pull from rewriting code blocks you wrote there as `text`.
 */
export function neutralizeLegacyBase(markdown: string, format: number): string {
	if (format >= ADF_NEUTRALIZED_FORMAT) return markdown;
	return markdown
		.replace(
			/^((?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*)(`{3,}|~{3,})[ \t]*([\w-]+)/gm,
			(match, prefix: string, fence: string, language: string) =>
				EXECUTABLE_LANGUAGES.has(language.toLowerCase()) ? `${prefix}${fence}text` : match,
		)
		.replace(/`(\s*)\$=/g, "`$1$ =");
}

/** True when two ADF fragments differ only in editor-only presentation attributes. */
export function sameContent(left: unknown, right: unknown): boolean {
	return JSON.stringify(stripPresentation(left)) === JSON.stringify(stripPresentation(right));
}

/**
 * Remove editor-only attributes, empty `attrs`/`marks`/`content`, and line breaks at either
 * end of a paragraph (which Markdown can't represent and don't show), so fragments compare by
 * content. Marks compare in any order, and smart links to pages by their page, as published.
 */
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
		if ((key === "marks" || key === "content") && Array.isArray(child) && child.length === 0)
			continue;
		result[key] = stripPresentation(child);
	}
	const { content, marks, attrs } = result as {
		content?: unknown;
		marks?: unknown;
		attrs?: unknown;
	};
	if (result["type"] === "paragraph" && Array.isArray(content)) {
		const trimmed = trimLineBreaks(content);
		if (trimmed.length > 0) result["content"] = trimmed;
		else delete result["content"];
	}
	if (Array.isArray(marks)) result["marks"] = [...(marks as unknown[])].sort(byMarkType);
	const url = (attrs as { url?: unknown } | undefined)?.url;
	if (result["type"] === "inlineCard" && typeof url === "string")
		result["attrs"] = { ...(attrs as object), url: publishedPageUrl(url) };
	return sortKeys(result) as T;
}

function byMarkType(left: unknown, right: unknown): number {
	return String((left as { type?: unknown }).type).localeCompare(
		String((right as { type?: unknown }).type),
	);
}

/**
 * A smart link's address as the publisher writes it: a link to a page loses the `~` of a
 * personal space and anything after the page ID, which Confluence resolves to the same page.
 */
function publishedPageUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	const page = /\/wiki\/spaces\/~?(\w+)\/pages\/(\d+)/.exec(parsed.pathname);
	if (!page) return url;
	parsed.pathname = `/wiki/spaces/${page[1]}/pages/${page[2]}`;
	return parsed.href;
}

/**
 * Drop line breaks at the start and end of a paragraph, and spaces next to a line break:
 * none of them show, and Markdown can't keep them.
 */
function trimLineBreaks(content: unknown[]): unknown[] {
	const isBreak = (node: unknown) => (node as { type?: unknown })?.type === "hardBreak";
	let start = 0;
	let end = content.length;
	while (start < end && isBreak(content[start])) start++;
	while (end > start && isBreak(content[end - 1])) end--;
	return content.slice(start, end).flatMap((node, offset) => {
		const index = start + offset;
		const { type, text } = node as { type?: unknown; text?: unknown };
		if (type !== "text" || typeof text !== "string") return [node];
		let trimmed = text;
		if (isBreak(content[index + 1])) trimmed = trimmed.replace(/[ \t]+$/, "");
		if (isBreak(content[index - 1])) trimmed = trimmed.replace(/^[ \t]+/, "");
		if (trimmed === text) return [node];
		return trimmed ? [{ ...(node as object), text: trimmed }] : [];
	});
}

type TextNode = { type: "text"; text: string; marks?: { type?: unknown }[] };

/**
 * Shape inline text the way Markdown can write it, before converting: spaces at the ends of
 * bold, italic or struck-through text move outside it (`**a **` isn't bold in Markdown), and
 * neighboring text with the same marks joins, as the publisher's parser joins it.
 */
function tidyText(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(tidyText);
	if (!isNode(node) || !node.content) return node;
	const content: unknown[] = [];
	for (const child of node.content.map(tidyText).flatMap(splitEdgeSpaces)) {
		const previous = content.at(-1);
		if (isText(child) && isText(previous) && sameMarks(child, previous))
			content[content.length - 1] = { ...previous, text: previous.text + child.text };
		else content.push(child);
	}
	return { ...node, content };
}

function splitEdgeSpaces(node: unknown): unknown[] {
	if (!isText(node) || !node.marks?.some((mark) => EMPHASIS_MARKS.has(String(mark.type))))
		return [node];
	if (node.marks.some((mark) => mark.type === "code")) return [node];
	const [, before = "", inner = "", after = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.text) ?? [];
	if (!inner || (!before && !after)) return [node];
	const outer = node.marks.filter((mark) => !EMPHASIS_MARKS.has(String(mark.type)));
	const space = (text: string): TextNode =>
		outer.length > 0 ? { type: "text", text, marks: outer } : { type: "text", text };
	return [
		...(before ? [space(before)] : []),
		{ ...node, text: inner },
		...(after ? [space(after)] : []),
	];
}

function isText(node: unknown): node is TextNode {
	const { type, text } = (node ?? {}) as { type?: unknown; text?: unknown };
	return type === "text" && typeof text === "string";
}

function sameMarks(left: TextNode, right: TextNode): boolean {
	const key = (node: TextNode) =>
		JSON.stringify(stripPresentation([...(node.marks ?? [])].sort(byMarkType)));
	return key(left) === key(right);
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
