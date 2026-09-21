import { resolveConfluencePageId } from "@markdown-confluence/lib";

/** Returns the wikilink target for a Confluence page ID, or undefined if no note has it. */
export type PageLinkResolver = (pageId: string) => string | undefined;

export interface RewrittenLinks {
	markdown: string;
	/** Page IDs linked from the text that have no note yet; their links stay web links. */
	unresolved: string[];
}

const FENCE = /^(\s*(?:>\s?)*)(`{3,}|~{3,})/;
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
	let fence: string | undefined;
	const lines = markdown.split("\n").map((line) => {
		const fenceMatch = FENCE.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[2]!;
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
			return line;
		}
		if (fence) return line;
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
	if (!anchor && (text === linkText || text === href || text === "")) return `[[${target}]]`;
	if (anchor && (text === href || text === "")) return `[[${target}]]`;
	return `[[${target}${separator}${text}]]`;
}

/**
 * Obsidian's default link format: the note name when it's unique in the vault, otherwise
 * the vault path. Both omit `.md`.
 */
export function linkTextFor(path: string, allNotePaths: readonly string[]): string {
	const withoutExtension = path.replace(/\.md$/, "");
	const name = withoutExtension.slice(withoutExtension.lastIndexOf("/") + 1);
	const sameName = allNotePaths.filter(
		(other) => other.replace(/\.md$/, "").split("/").pop() === name,
	);
	return sameName.length <= 1 ? name : withoutExtension;
}

/** A resolver over page ID → note path, using Obsidian's shortest-unique link format. */
export function createPageLinkResolver(
	pathsById: ReadonlyMap<string, string>,
	allNotePaths: readonly string[],
): PageLinkResolver {
	return (pageId) => {
		const path = pathsById.get(pageId);
		return path ? linkTextFor(path, allNotePaths) : undefined;
	};
}
