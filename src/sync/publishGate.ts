import type { ConfluenceRemote } from "./confluenceRemote";
import { hasConflictMarkers } from "./merge";
import type { SyncStateStore } from "./syncState";

export interface NoteToPublish {
	path: string;
	pageId: string | undefined;
	text: string;
}

export interface PublishCheck {
	/** Notes that must be fixed before publishing, with the reason. */
	blocked: { fileName: string; reason: string }[];
	/**
	 * Notes whose Confluence page is exactly the version last pulled or published. They may
	 * overwrite a page another user edited last, because that edit was already merged.
	 */
	upToDate: Set<string>;
}

export const NEEDS_PULL =
	"Confluence has changes that you haven't pulled. Pull this note, then publish again.";
export const HAS_CONFLICTS = "Resolve the merge conflict markers in this note, then publish again.";

/**
 * Like `git push`, refuse to publish over Confluence changes that haven't been pulled.
 * Pages with no recorded base keep the publisher's own check, which refuses to overwrite a
 * page that another user edited last.
 */
export async function checkBeforePublish(
	notes: readonly NoteToPublish[],
	remote: ConfluenceRemote,
	state: SyncStateStore,
): Promise<PublishCheck> {
	const blocked: PublishCheck["blocked"] = [];
	const upToDate = new Set<string>();
	const linked: { path: string; pageId: string }[] = [];
	for (const note of notes) {
		if (hasConflictMarkers(note.text)) blocked.push({ fileName: note.path, reason: HAS_CONFLICTS });
		else if (note.pageId) linked.push({ path: note.path, pageId: note.pageId });
	}

	// Snapshots are local files, so they can all be read at once.
	const bases = await Promise.all(linked.map((note) => state.get(note.pageId)));
	const withBase = linked.flatMap((note, index) => {
		const base = bases[index];
		return base ? [{ ...note, baseVersion: base.version }] : [];
	});
	const versions = await remote.getVersions(withBase.map((note) => note.pageId));
	for (const { path, pageId, baseVersion } of withBase) {
		const remoteVersion = versions.get(pageId)?.version;
		if (remoteVersion === undefined) continue;
		if (remoteVersion > baseVersion) blocked.push({ fileName: path, reason: NEEDS_PULL });
		else if (remoteVersion === baseVersion) upToDate.add(path);
	}
	return { blocked, upToDate };
}
