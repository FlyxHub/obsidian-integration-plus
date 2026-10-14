import { resolveConfluencePageId } from "@markdown-confluence/lib";
import { mapOutsideCode } from "../fences";
import { baseName, decodeLink } from "../paths";

/** Returns the wikilink target for a Confluence page ID, or undefined if no note has it. */
export type PageLinkResolver = (pageId: string) => string | undefined;

export interface RewrittenLinks {
	markdown: string;
	/** Page IDs linked from the text that have no note yet; their links stay web links. */
	unresolved: string[];
}

const TABLE_ROW = /^\s*(?:>\s?)*\|/;
/** A Markdown link, with the backslashes and `!` before it, to tell links from images. */
const MARKDOWN_LINK = /(\\*)(!?)\[((?:[^[\]\\]|\\.)*)\]\(([^()\s]+)\)/g;
const MARKDOWN_ESCAPE = /\\([\\`*_{}[\]()#+\-.!|<>~])/g;
/** Characters that end or change a wikilink, start code, or break the line. */
const UNSAFE_ANCHOR = /[[\]|#^`\\<>\p{Cc}]/u;

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
	const rewritten = mapOutsideCode(markdown, (segment, line) =>
		segment.replace(
			MARKDOWN_LINK,
			(match, slashes: string, bang: string, text: string, href: string) => {
				// An odd number of backslashes escapes what follows: `\[` isn't a link, and `\!`
				// is a literal `!` before one. Images stay images.
				if (slashes.length % 2 === 1 ? !bang : !!bang) return match;
				const prefix = slashes + bang;
				const target = pageLinkTarget(href, siteUrl);
				if (!target) return match;
				const linkText = resolve(target.pageId);
				if (!linkText) {
					unresolved.add(target.pageId);
					return match;
				}
				const separator = TABLE_ROW.test(line) ? "\\|" : "|";
				const wikilink = toWikilink(linkText, target.anchor, text, href, separator);
				return wikilink ? prefix + wikilink : match;
			},
		),
	);
	return { markdown: rewritten, unresolved: [...unresolved] };
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
	return hash ? decodeLink(hash.slice(1)).replace(/-/g, " ").trim() : "";
}

function toWikilink(
	linkText: string,
	anchor: string,
	rawText: string,
	href: string,
	separator: string,
): string | undefined {
	const text = rawText.replace(MARKDOWN_ESCAPE, "$1");
	// Wikilinks can't hold these, and the anchor comes from a URL that anyone who can edit the
	// page chooses: unchecked, it could close the link and add Markdown. Keep the web link.
	if (/[|`]|\[\[|\]\]/.test(text) || UNSAFE_ANCHOR.test(anchor)) return undefined;
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
