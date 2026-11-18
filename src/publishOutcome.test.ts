import { expect, test } from "@effect/vitest";
import type { UploadAdfFileResult } from "@markdown-confluence/lib";
import { EDITED_BY_OTHER_USER, classifyPublishResult, type PublishContext } from "./publishOutcome";

const uploaded = { contentResult: "updated" } as unknown as UploadAdfFileResult;
const otherUser = `${EDITED_BY_OTHER_USER}: Someone`;
const all: PublishContext = { changed: undefined, forceOverwrite: false, upToDate: new Set() };
const partial: PublishContext = { ...all, changed: new Set(["changed.md"]) };

test("uploads are reported, and failures keep the publisher's reason", () => {
	expect(classifyPublishResult("a.md", uploaded, undefined, all)).toEqual({
		kind: "uploaded",
		result: uploaded,
	});
	expect(classifyPublishResult("a.md", undefined, "Boom", all)).toEqual({
		kind: "failed",
		reason: "Boom",
	});
	expect(classifyPublishResult("a.md", undefined, undefined, all)).toEqual({
		kind: "failed",
		reason: "No reason provided",
	});
});

test("folder notes sent only for the page tree aren't reported unless they failed", () => {
	expect(classifyPublishResult("Folder/Folder.md", uploaded, undefined, partial)).toEqual({
		kind: "tree-only",
		result: uploaded,
	});
	expect(classifyPublishResult("Folder/Folder.md", undefined, otherUser, partial)).toEqual({
		kind: "tree-only",
		result: undefined,
	});
	expect(classifyPublishResult("Folder/Folder.md", undefined, "Boom", partial)).toEqual({
		kind: "failed",
		reason: "Boom",
	});
	expect(classifyPublishResult("changed.md", uploaded, undefined, partial).kind).toBe("uploaded");
});

test("another user's edit is published over only when it was pulled, or the setting allows it", () => {
	expect(classifyPublishResult("a.md", undefined, otherUser, all)).toEqual({
		kind: "failed",
		reason: otherUser,
	});
	const upToDate = { ...all, upToDate: new Set(["a.md"]) };
	expect(classifyPublishResult("a.md", undefined, otherUser, upToDate)).toEqual({
		kind: "overwrite",
		checkBase: true,
	});
	// A full publish passes the setting to the publisher, which then never refuses.
	expect(
		classifyPublishResult("a.md", undefined, otherUser, { ...all, forceOverwrite: true }).kind,
	).toBe("failed");
	expect(
		classifyPublishResult("changed.md", undefined, otherUser, { ...partial, forceOverwrite: true }),
	).toEqual({ kind: "overwrite", checkBase: false });
	expect(
		classifyPublishResult("changed.md", undefined, otherUser, {
			...partial,
			upToDate: new Set(["changed.md"]),
		}),
	).toEqual({ kind: "overwrite", checkBase: true });
});
