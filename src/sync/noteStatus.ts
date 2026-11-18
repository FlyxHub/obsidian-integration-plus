import { MERGE_FORMAT } from "./adfMarkdown";
import type { PageLinkResolver } from "./pageLinks";
import type { SyncBase } from "./syncState";

/*
 * A linked note's sync status, like `git status`, compared with its snapshot (`SyncBase`).
 * Publishing, the publish check and pulling all decide from these, so each state means the
 * same thing everywhere. Conflicts are the one state kept in the note itself, as markers
 * (`hasConflictMarkers`).
 */

/** Confluence's side: the page's current version against the snapshot's. */
export type RemoteStatus =
	/** No snapshot: the page was never published or pulled with sync, or its file is gone. */
	| "no-base"
	/** Confluence reported no version: the page was deleted, or isn't readable. */
	| "unknown"
	/** The page is at the snapshot's version. */
	| "at-base"
	/** Someone saved the page after the snapshot. */
	| "changed"
	/** The page reports a version older than the snapshot. */
	| "older";

export function remoteStatus(
	base: Pick<SyncBase, "version"> | undefined,
	remoteVersion: number | undefined,
): RemoteStatus {
	if (!base) return "no-base";
	if (remoteVersion === undefined) return "unknown";
	if (remoteVersion === base.version) return "at-base";
	return remoteVersion > base.version ? "changed" : "older";
}

/**
 * The note's side: "in-sync" only when the snapshot recorded the note's fingerprint and it
 * still matches. A snapshot without one means the note isn't known to be in sync: it had
 * local changes at the last pull, has Dataview queries, was edited while it was published,
 * or has no history. Such a note always counts as changed. The note's fingerprint is only
 * computed when the snapshot has one to compare with.
 */
export async function localStatus(
	base: Pick<SyncBase, "localFingerprint"> | undefined,
	fingerprint: () => Promise<string | undefined>,
): Promise<"in-sync" | "changed"> {
	const recorded = base?.localFingerprint;
	if (recorded === undefined) return "changed";
	return (await fingerprint()) === recorded ? "in-sync" : "changed";
}

/** The snapshot was converted by the current `adfToMergeMarkdown`. */
export function hasCurrentFormat(base: Pick<SyncBase, "format"> | undefined): boolean {
	return base?.format === MERGE_FORMAT;
}

/**
 * The snapshot needs no new conversion: it has the current format, every image has a local
 * copy, and no page it links to has gained a note. Otherwise a pull converts the page again
 * even when it didn't change, so the improvement reaches the note.
 */
export function snapshotIsCurrent(
	base: Pick<SyncBase, "format" | "unresolvedLinks" | "unresolvedMedia"> | undefined,
	resolve: PageLinkResolver,
): boolean {
	return (
		!!base &&
		hasCurrentFormat(base) &&
		!base.unresolvedLinks.some((id) => resolve(id)) &&
		base.unresolvedMedia.length === 0
	);
}
