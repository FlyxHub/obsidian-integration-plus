import {
	convertADFToMarkdown,
	parseMarkdownToADF,
	readAdfDocument,
} from "@markdown-confluence/lib";

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
export function adfToMergeMarkdown(input: unknown, confluenceBaseUrl: string): string {
	const document = readAdfDocument(input) as { content?: unknown[] };
	const blocks = (document.content ?? []).filter(isNode);
	return blocks.map((block) => blockToMarkdown(block, confluenceBaseUrl)).join("\n\n") + "\n";
}

function blockToMarkdown(block: AdfNode, confluenceBaseUrl: string): string {
	const readable = convertADFToMarkdown(asDocument(block), { lossless: false }).trim();
	if (readable && !readable.startsWith("```adf")) {
		const reparsed = parseMarkdownToADF(readable, confluenceBaseUrl).content ?? [];
		if (sameContent(reparsed, [block])) return neutralizeExecutableMarkdown(readable);
	}
	return neutralizeExecutableMarkdown(
		convertADFToMarkdown(asDocument(stripPresentation(block)), { lossless: true }).trim(),
	);
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
export function stripPresentation<T>(value: T): T {
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
