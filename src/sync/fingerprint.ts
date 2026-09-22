import { createHash } from "node:crypto";
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
	]);
}

/** Dataview results can change without the note changing, so these notes are always sent. */
export function hasLiveQueries(text: string, settings: ObsidianPluginSettings): boolean {
	return settings.renderDataview && /^\s*(`{3,}|~{3,})\s*dataview\b/im.test(text);
}

const WIKI_REFERENCE = /(!?)\[\[([^\]|#^]+)[^\]]*\]\]/g;
const MARKDOWN_EMBED = /!\[[^\]]*\]\(<?([^)\s>]+)>?\)/g;

/**
 * Link targets that a note refers to: embeds, which the publisher copies into the page, and
 * wikilinks, which become links to other pages. Web addresses are ignored.
 */
export function noteReferences(text: string): { embeds: string[]; links: string[] } {
	const embeds = new Set<string>();
	const links = new Set<string>();
	for (const [, bang, target] of text.matchAll(WIKI_REFERENCE)) {
		const name = target!.trim();
		if (name) (bang ? embeds : links).add(name);
	}
	for (const [, target] of text.matchAll(MARKDOWN_EMBED)) {
		if (!/^[a-z][a-z0-9+.-]*:/i.test(target!)) embeds.add(decodeLinkPath(target!));
	}
	return { embeds: [...embeds], links: [...links] };
}

function decodeLinkPath(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
