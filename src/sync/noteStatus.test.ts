import { expect, test, vi } from "@effect/vitest";
import { MERGE_FORMAT } from "./adfMarkdown";
import { localStatus, remoteStatus, snapshotIsCurrent } from "./noteStatus";

test("remote status compares the page's version with the snapshot's", () => {
	expect(remoteStatus(undefined, 3)).toBe("no-base");
	expect(remoteStatus({ version: 3 }, undefined)).toBe("unknown");
	expect(remoteStatus({ version: 3 }, 3)).toBe("at-base");
	expect(remoteStatus({ version: 3 }, 4)).toBe("changed");
	expect(remoteStatus({ version: 3 }, 2)).toBe("older");
});

test("a note is in sync only when its recorded fingerprint still matches", async () => {
	const fingerprint = vi.fn(async () => "abc");
	expect(await localStatus(undefined, fingerprint)).toBe("changed");
	expect(await localStatus({ localFingerprint: undefined }, fingerprint)).toBe("changed");
	// Nothing to compare with, so the note isn't read.
	expect(fingerprint).not.toHaveBeenCalled();
	expect(await localStatus({ localFingerprint: "abc" }, fingerprint)).toBe("in-sync");
	expect(await localStatus({ localFingerprint: "old" }, fingerprint)).toBe("changed");
	expect(await localStatus({ localFingerprint: "abc" }, async () => undefined)).toBe("changed");
});

test("a snapshot needs converting again for an old format, missing images or new link targets", () => {
	const base = { format: MERGE_FORMAT, unresolvedLinks: ["7"], unresolvedMedia: [] };
	const none = () => undefined;
	expect(snapshotIsCurrent(undefined, none)).toBe(false);
	expect(snapshotIsCurrent(base, none)).toBe(true);
	expect(snapshotIsCurrent({ ...base, format: MERGE_FORMAT - 1 }, none)).toBe(false);
	expect(snapshotIsCurrent({ ...base, unresolvedMedia: ["file"] }, none)).toBe(false);
	expect(snapshotIsCurrent(base, (id) => (id === "7" ? "Note" : undefined))).toBe(false);
});
