import { createFenceTracker } from "./fences";

/** Returns the Confluence page URL of the note a wikilink points to, if it was published. */
export type PageUrlLookup = (linkpath: string) => string | undefined;

const WIKILINK = /(!?)\[\[([^\]\n]+)\]\]/g;

/**
 * Turn wikilinks to published notes into web links to their Confluence pages. The lib
 * resolves wikilinks only against the notes in the same publish, so "Publish changes" would
 * drop links to notes it doesn't send. A link without an alias gets the URL as its text,
 * which the lib turns into a smart link, as it does for wikilinks it resolves itself.
 * Embeds, code blocks and inline code are left alone.
 */
export function wikilinksToPageLinks(markdown: string, pageUrl: PageUrlLookup): string {
	const inCode = createFenceTracker();
	return markdown
		.split("\n")
		.map((line) =>
			inCode(line)
				? line
				: line
						.split("`")
						.map((segment, index) =>
							index % 2 === 1
								? segment
								: segment.replace(WIKILINK, (link, embed: string, inner: string) =>
										embed ? link : (toPageLink(inner, pageUrl) ?? link),
									),
						)
						.join("`"),
		)
		.join("\n");
}

function toPageLink(inner: string, pageUrl: PageUrlLookup): string | undefined {
	// In table rows, the alias separator is escaped as `\|`.
	const [target = "", alias] = inner.split(/\\?\|/, 2);
	const hash = target.indexOf("#");
	const linkpath = (hash === -1 ? target : target.slice(0, hash)).trim();
	const url = linkpath ? pageUrl(linkpath)?.replace(/\/$/, "") : undefined;
	if (!url) return undefined;
	// Confluence heading anchors replace spaces with hyphens.
	const heading = hash === -1 ? "" : target.slice(hash + 1).trim();
	const href = heading ? `${url}#${encodeURIComponent(heading.replace(/\s+/g, "-"))}` : url;
	return `[${alias?.trim() || href}](${href})`;
}
