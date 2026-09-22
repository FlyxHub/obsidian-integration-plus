import { resolveConfluencePageId } from "@markdown-confluence/lib";
import { createFenceTracker } from "../fences";
import { baseName } from "../paths";

/** Returns the wikilink target for a Confluence page ID, or undefined if no note has it. */
export type PageLinkResolver = (pageId: string) => string | undefined;

export interface RewrittenLinks {
	markdown: string;
	/** Page IDs linked from the text that have no note yet; their links stay web links. */
	unresolved: string[];
}

const TABLE_ROW = /^\s*(?:>\s?)*\|/;
const MARKDOWN_LINK = /\[((?:[^[\]\\]|\\.)*)\]\(([^()\s]+)\)/g;
const MARKDOWN_ESCAPE = /\\([\\`*_{}[\]()#+\-.!|<>~])/g;

/**
 * Turn links to Confluence pages into Obsidian wikilinks to the notes linked to those pages.
 * Code blocks (including `adf` fences) and inline code are left alone, and links to pages
 * without a note stay web links. In table rows, the alias separator is escaped as `\|`.
 */
export function rewritePageLinks(
	markdown: string,
	siteUrl: string,
	resolve: PageLinkResolver,
): RewrittenLinks {
	const unresolved = new Set<string>();
	const inCode = createFenceTracker();
	const lines = markdown.split("\n").map((line) => {
		if (inCode(line)) return line;
		const separator = TABLE_ROW.test(line) ? "\\|" : "|";
		// Odd segments of a backtick split are inline code.
		return line
			.split("`")
			.map((segment, index) =>
				index % 2 === 1
					? segment
					: segment.replace(MARKDOWN_LINK, (link, text: string, href: string) => {
							const target = pageLinkTarget(href, siteUrl);
							if (!target) return link;
							const linkText = resolve(target.pageId);
							if (!linkText) {
								unresolved.add(target.pageId);
								return link;
							}
							return toWikilink(linkText, target.anchor, text, href, separator) ?? link;
						}),
			)
			.join("`");
	});
	return { markdown: lines.join("\n"), unresolved: [...unresolved] };
}

/** The page ID and heading anchor of a link to a page on this Confluence site. */
export function pageLinkTarget(
	href: string,
	siteUrl: string,
): { pageId: string; anchor: string } | undefined {
	if (!siteUrl) return undefined;
	let url: URL;
	try {
		url = new URL(href, siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`);
	} catch {
		return undefined;
	}
	if (!/^https?:$/.test(url.protocol) || !href.match(/^(https?:\/\/|\/wiki\/)/)) return undefined;
	let pageId: string;
	try {
		pageId = resolveConfluencePageId(url.href, siteUrl);
	} catch {
		return undefined;
	}
	return { pageId, anchor: headingFromAnchor(url.hash) };
}

/** Confluence heading anchors replace spaces with hyphens; Obsidian links use the heading text. */
function headingFromAnchor(hash: string): string {
	if (!hash) return "";
	let decoded = hash.slice(1);
	try {
		decoded = decodeURIComponent(decoded);
	} catch {
		// Keep the raw anchor.
	}
	return decoded.replace(/-/g, " ").trim();
}

function toWikilink(
	linkText: string,
	anchor: string,
	rawText: string,
	href: string,
	separator: string,
): string | undefined {
	const text = rawText.replace(MARKDOWN_ESCAPE, "$1");
	// Wikilink aliases can't contain these; keep the web link rather than break the text.
	if (/\||\[\[|\]\]/.test(text)) return undefined;
	const target = anchor ? `${linkText}#${anchor}` : linkText;
	// Without an alias, Obsidian shows the link target and publishing uses it as the link
	// text, so drop the alias only when it's exactly the target. Smart links show the URL as
	// their text, so they become a plain `[[Note]]`.
	if (text === href || text === "" || (!anchor && text === linkText)) return `[[${target}]]`;
	return `[[${target}${separator}${text}]]`;
}

/**
 * Obsidian's default link format: the note name when it's unique in the vault, otherwise
 * the vault path. Both omit `.md`. Build it once and reuse it for every link in a pull.
 */
export function createLinkTextIndex(allPaths: readonly string[]): (path: string) => string {
	const namesInUse = new Map<string, number>();
	for (const path of allPaths) {
		const name = linkName(path);
		namesInUse.set(name, (namesInUse.get(name) ?? 0) + 1);
	}
	return (path) => {
		const name = linkName(path);
		return (namesInUse.get(name) ?? 0) <= 1 ? name : path.replace(/\.md$/, "");
	};
}

function linkName(path: string): string {
	return baseName(path).replace(/\.md$/, "");
}

/** A resolver over page ID → note path, using Obsidian's shortest-unique link format. */
export function createPageLinkResolver(
	pathsById: ReadonlyMap<string, string>,
	allNotePaths: readonly string[],
): PageLinkResolver {
	const linkText = createLinkTextIndex(allNotePaths);
	return (pageId) => {
		const path = pathsById.get(pageId);
		return path ? linkText(path) : undefined;
	};
}
