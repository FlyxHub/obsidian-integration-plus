import { expect, test } from "@effect/vitest";
import { normalizeCalloutsForPublish } from "./callouts";

test("moves the first body line of an untitled callout into the title position", () => {
	expect(normalizeCalloutsForPublish("> [!warning]\n> Be careful.\n> More.")).toBe(
		"> [!warning] Be careful.\n> More.",
	);
});

test("leaves titled, collapsible and non-paragraph callouts unchanged", () => {
	for (const markdown of [
		"> [!warning] Heads up\n> Body",
		"> [!warning]-\n> Hidden body",
		"> [!warning]\n> - list item",
		"> [!warning]\n>\n> Body after a blank line",
		"> [!warning]\n> # Heading",
		"> [!warning]",
		"> Plain quote\n> text",
	])
		expect(normalizeCalloutsForPublish(markdown)).toBe(markdown);
});

test("ignores callout syntax inside code blocks", () => {
	const markdown = "```md\n> [!info]\n> Example\n```\n\n> [!info]\n> Real";
	expect(normalizeCalloutsForPublish(markdown)).toBe(
		"```md\n> [!info]\n> Example\n```\n\n> [!info] Real",
	);
});
