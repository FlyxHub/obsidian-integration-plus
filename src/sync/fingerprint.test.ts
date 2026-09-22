import { expect, test } from "@effect/vitest";
import { mergeSettings } from "../settings";
import { fingerprintNote, hasLiveQueries, noteReferences, publishSettingsKey } from "./fingerprint";

const settings = mergeSettings({});
const note = {
	path: "Docs/A.md",
	text: "Text.\n",
	dependencies: ["embed:images/a.png:1:10"],
	settings: publishSettingsKey(settings),
};

test("the fingerprint changes with the text, path, embedded files and settings", () => {
	const original = fingerprintNote(note);
	expect(fingerprintNote({ ...note })).toBe(original);
	expect(fingerprintNote({ ...note, text: "Text!\n" })).not.toBe(original);
	expect(fingerprintNote({ ...note, path: "Docs/B.md" })).not.toBe(original);
	expect(fingerprintNote({ ...note, dependencies: ["embed:images/a.png:2:10"] })).not.toBe(
		original,
	);
	const themed = publishSettingsKey({ ...settings, mermaidTheme: "forest" });
	expect(fingerprintNote({ ...note, settings: themed })).not.toBe(original);
});

test("the fingerprint doesn't depend on the order of dependencies", () => {
	const both = ["link:B:B.md:2", "embed:images/a.png:1:10"];
	expect(fingerprintNote({ ...note, dependencies: both })).toBe(
		fingerprintNote({ ...note, dependencies: [...both].reverse() }),
	);
});

test("finds embeds and wikilinks, ignoring headings, aliases and web images", () => {
	const text = [
		"![[Shared/Checklist#Steps|steps]] and [[Other note|see this]] and [[Other note]]",
		"![diagram](images/My%20diagram.png) ![remote](https://example.com/a.png)",
	].join("\n");
	expect(noteReferences(text)).toEqual({
		embeds: ["Shared/Checklist", "images/My diagram.png"],
		links: ["Other note"],
	});
});

test("notes with Dataview queries always count as changed while Dataview publishing is on", () => {
	const text = "```dataview\nLIST\n```\n";
	expect(hasLiveQueries(text, { ...settings, renderDataview: true })).toBe(true);
	expect(hasLiveQueries(text, { ...settings, renderDataview: false })).toBe(false);
	expect(hasLiveQueries("```js\n```\n", { ...settings, renderDataview: true })).toBe(false);
});
