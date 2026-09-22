import { expect, test } from "@effect/vitest";
import { ConfluenceUploadSettings } from "@markdown-confluence/lib";
import { isExcluded, publishFlagFor } from "./publishSelection";

const settings = {
	...ConfluenceUploadSettings.DEFAULT_SETTINGS,
	folderToPublish: "Docs",
	foldersToExclude: ["Docs/Private"],
};

test("sets connie-publish only when folder rules don't already give the wanted result", () => {
	expect(publishFlagFor("Docs/A.md", {}, settings, true)).toBeUndefined();
	expect(publishFlagFor("Docs/A.md", {}, settings, false)).toBe(false);
	expect(publishFlagFor("Notes/A.md", { "connie-publish": false }, settings, true)).toBe(true);
	expect(publishFlagFor("Notes/A.md", { "connie-publish": true }, settings, false)).toBeUndefined();
});

test("excluded folders can't be published even with connie-publish", () => {
	expect(isExcluded("Docs/Private/A.md", settings)).toBe(true);
	expect(isExcluded("Docs/A.md", settings)).toBe(false);
});
