import { createHash } from "node:crypto";
import { decodeLink, hasUrlScheme } from "../paths";
import type { ObsidianPluginSettings } from "../settings";

/**
 * Bump when the fingerprint's inputs change, so every note counts as changed once and is
 * published again, instead of being compared with fingerprints made the old way.
 */
const FINGERPRINT_FORMAT = 1;

/** Everything about a note that decides what publishing it sends to Confluence. */
export interface NoteState {
	path: string;
	text: string;
	/**
	 * Embedded files and linked notes, each as a stamp that changes when the file does
	 * (such as `embed:images/a.png:<mtime>:<size>`).
	 */
	dependencies: readonly string[];
	/** From `publishSettingsKey`. */
	settings: string;
}

/**
 * A short hash of a note's publish-relevant state. A publish or pull that leaves the note in
 * sync with Confluence stores it; the next publish sends only notes whose hash changed.
 */
export function fingerprintNote(state: NoteState): string {
	const input = JSON.stringify([
		FINGERPRINT_FORMAT,
		state.path,
		state.text,
		[...state.dependencies].sort(),
		state.settings,
	]);
	return createHash("sha256").update(input).digest("hex");
}

/** The settings that change what a publish produces. Changing one marks every note changed. */
export function publishSettingsKey(settings: ObsidianPluginSettings): string {
	return JSON.stringify([
		settings.confluenceBaseUrl,
		settings.confluenceParentId,
		settings.folderToPublish,
		settings.firstHeadingPageTitle,
		settings.jiraUrl ?? "",
		settings.lockPublishedPages ?? false,
		settings.renderDataview,
		settings.maxImageWidth,
		settings.mermaidTheme,
		settings.mermaid ?? null,
		settings.kroki ?? null,
		settings.plantuml,
		// Added later, and only when set, so existing fingerprints stay valid.
		...optional("siteUrl", settings.confluenceSiteUrl),
		...optional("header", settings.pageHeaderMarkdown),
		...optional("footer", settings.pageFooterMarkdown),
		...optional("ignoredLanguages", settings.ignoredCodeBlockLanguages),
	]);
}

function optional(name: string, value: unknown): unknown[] {
	const empty = value === undefined || value === "" || (Array.isArray(value) && !value.length);
	return empty ? [] : [[name, value]];
}

/**
 * Dataview results can change without the note changing, so these notes are always sent.
 * The publisher runs queries inside quotes, callouts and list items too.
 */
export function hasLiveQueries(text: string, settings: ObsidianPluginSettings): boolean {
	return (
		settings.renderDataview &&
		/^[ \t>]*(?:[-+*][ \t]+|\d+[.)][ \t]+)?(`{3,}|~{3,})[ \t]*dataview\b/im.test(text)
	);
}

/** The address of a Markdown embed after its `](`, read in place; `]` ends it, as `)` does. */
const EMBED_ADDRESS = /<?([^)\s>\]]+)>?\)/y;

/**
 * Link targets that a note refers to: embeds, which the publisher copies into the page, and
 * wikilinks, which become links to other pages. Web addresses are ignored.
 *
 * The text includes code, which a pulled page can fill with anything, so links are found by
 * searching forward through each line instead of with a pattern that backtracks: a run of
 * `[[` is read once, not once per `[[`.
 */
export function noteReferences(text: string): { embeds: string[]; links: string[] } {
	const embeds = new Set<string>();
	const links = new Set<string>();
	for (const line of text.split("\n")) {
		for (let from = 0; ;) {
			const start = line.indexOf("[[", from);
			const end = start === -1 ? -1 : line.indexOf("]]", start + 2);
			if (end === -1) break;
			const name = line
				.slice(start + 2, end)
				.split(/[|#^]/, 1)[0]!
				.trim();
			if (name) (line[start - 1] === "!" ? embeds : links).add(name);
			from = end + 2;
		}
		for (let from = 0; ;) {
			const start = line.indexOf("![", from);
			const open = start === -1 ? -1 : line.indexOf("](", start + 2);
			if (open === -1) break;
			EMBED_ADDRESS.lastIndex = open + 2;
			const address = EMBED_ADDRESS.exec(line);
			from = address ? EMBED_ADDRESS.lastIndex : open + 2;
			if (address && !hasUrlScheme(address[1]!)) embeds.add(decodeLink(address[1]!));
		}
	}
	return { embeds: [...embeds], links: [...links] };
}
