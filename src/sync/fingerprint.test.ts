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

test("reads long runs of unclosed links, as pulled code can hold, in linear time", () => {
	const text = `\`\`\`text\n${"[[a".repeat(20000)}\n${"[[a]b".repeat(20000)}\n${"![a](b".repeat(20000)}\n\`\`\`\n`;
	const started = performance.now();
	expect(noteReferences(text)).toEqual({ embeds: [], links: [] });
	expect(performance.now() - started).toBeLessThan(500);
	expect(noteReferences("[[a]] ![[b.png]] ![c](d.png) [[e|f]]")).toEqual({
		embeds: ["b.png", "d.png"],
		links: ["a", "e"],
	});
});

test("notes with Dataview queries always count as changed while Dataview publishing is on", () => {
	const text = "```dataview\nLIST\n```\n";
	expect(hasLiveQueries(text, { ...settings, renderDataview: true })).toBe(true);
	expect(hasLiveQueries(text, { ...settings, renderDataview: false })).toBe(false);
	expect(hasLiveQueries("```js\n```\n", { ...settings, renderDataview: true })).toBe(false);
	// The publisher also runs queries in callouts, quotes and list items.
	const live = { ...settings, renderDataview: true };
	expect(hasLiveQueries("> [!info]\n> ```dataview\n> LIST\n> ```\n", live)).toBe(true);
	expect(hasLiveQueries("- item\n  ~~~dataview\n  LIST\n  ~~~\n", live)).toBe(true);
	expect(hasLiveQueries("```dataviewjs\n```\n", live)).toBe(false);
});

test("settings added to the key later change it only when they're set", () => {
	const key = publishSettingsKey(settings);
	expect(
		publishSettingsKey({ ...settings, pageHeaderMarkdown: "", ignoredCodeBlockLanguages: [] }),
	).toBe(key);
	expect(
		publishSettingsKey({ ...settings, confluenceSiteUrl: "https://site.atlassian.net" }),
	).not.toBe(key);
	expect(publishSettingsKey({ ...settings, pageFooterMarkdown: "Footer" })).not.toBe(key);
});
