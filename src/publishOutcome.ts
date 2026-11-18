import type { UploadAdfFileResult } from "@markdown-confluence/lib";

/** The publisher's error when a page was last edited by someone else. */
export const EDITED_BY_OTHER_USER = "Page last updated by another user";

/** What becomes of one note the publisher reported on. */
export type PublishOutcome =
	| { kind: "uploaded"; result: UploadAdfFileResult }
	/**
	 * A folder note that a partial publish sent only for the page tree. It isn't reported, but
	 * its pull base is recorded when the page got a new version (`result`).
	 */
	| { kind: "tree-only"; result: UploadAdfFileResult | undefined }
	/**
	 * The publisher refused because another user edited the page last, but publishing over it
	 * is safe: publish again with `forceOverwrite`. With `checkBase`, first confirm that the
	 * page is still at the version last pulled or published.
	 */
	| { kind: "overwrite"; checkBase: boolean }
	| { kind: "failed"; reason: string };

export interface PublishContext {
	/** The changed notes, when publishing only changes; undefined when publishing all. */
	changed: ReadonlySet<string> | undefined;
	/** The "Overwrite other users' edits" setting. */
	forceOverwrite: boolean;
	/** Notes whose page was at the version last pulled or published (`checkBeforePublish`). */
	upToDate: ReadonlySet<string>;
}

/** Decide what to do with the publisher's result for the note at `path`. */
export function classifyPublishResult(
	path: string,
	uploaded: UploadAdfFileResult | undefined,
	reason: string | undefined,
	{ changed, forceOverwrite, upToDate }: PublishContext,
): PublishOutcome {
	const editedByOtherUser = !uploaded && !!reason?.includes(EDITED_BY_OTHER_USER);
	if (changed && !changed.has(path) && (uploaded || editedByOtherUser))
		return { kind: "tree-only", result: uploaded };
	if (uploaded) return { kind: "uploaded", result: uploaded };
	// A partial publish leaves the setting off for the publisher, so it's applied here. Without
	// it, the other user's edit must be the version that was pulled and merged into this note.
	const overwriteBySetting = changed !== undefined && forceOverwrite;
	if (editedByOtherUser && (overwriteBySetting || upToDate.has(path)))
		return { kind: "overwrite", checkBase: !overwriteBySetting };
	return { kind: "failed", reason: reason ?? "No reason provided" };
}
