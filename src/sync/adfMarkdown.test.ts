import { expect, test } from "@effect/vitest";
import { parseMarkdownToADF } from "@markdown-confluence/lib";
import { adfToMergeMarkdown, neutralizeExecutableMarkdown, sameContent } from "./adfMarkdown";

const BASE_URL = "https://example.atlassian.net";
const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string, attrs?: Record<string, unknown>) => ({
	type: "paragraph",
	...(attrs ? { attrs } : {}),
	content: [text(value)],
});
const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });

test("converts editor-saved blocks to readable Markdown", () => {
	const markdown = adfToMergeMarkdown(
		doc(
			{ type: "heading", attrs: { level: 1, localId: "h" }, content: [text("Title")] },
			paragraph("Hello.", { localId: "p" }),
			{
				type: "taskList",
				attrs: { localId: "tl" },
				content: [
					{ type: "taskItem", attrs: { localId: "a", state: "TODO" }, content: [text("todo")] },
					{ type: "taskItem", attrs: { localId: "b", state: "DONE" }, content: [text("done")] },
				],
			},
		),
		BASE_URL,
	);
	expect(markdown).toBe("# Title\n\nHello.\n\n- [ ] todo\n- [x] done\n");
});

test("separates blocks with blank lines so tables do not absorb paragraphs", () => {
	const cell = (type: string, value: string) => ({
		type,
		attrs: { colspan: 1, rowspan: 1, colwidth: [200] },
		content: [paragraph(value)],
	});
	const table = {
		type: "table",
		attrs: { isNumberColumnEnabled: false, layout: "default", localId: "t" },
		content: [
			{ type: "tableRow", content: [cell("tableHeader", "A"), cell("tableHeader", "B")] },
			{ type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "2")] },
		],
	};
	const markdown = adfToMergeMarkdown(doc(table, paragraph("After.")), BASE_URL);
	expect(markdown).toMatch(/\| 1 +\| 2 +\|\n\nAfter\.\n$/);
});

test("keeps Confluence-only content as an adf fence", () => {
	const status = {
		type: "paragraph",
		content: [
			text("State: "),
			{ type: "status", attrs: { text: "DONE", color: "green", localId: "s" } },
		],
	};
	const markdown = adfToMergeMarkdown(doc(status), BASE_URL);
	expect(markdown.startsWith("```adf")).toBe(true);
	expect(markdown).toContain('"color": "green"');
	expect(markdown).not.toContain("localId");
});

test("round-trips Markdown produced by the publisher", () => {
	const source = "# Plan\n\nIntro with **bold** and `code`.\n\n- one\n- two\n\n> Quote\n";
	expect(adfToMergeMarkdown(parseMarkdownToADF(source, BASE_URL), BASE_URL)).toBe(source);
});

test("compares content while ignoring editor-only attributes", () => {
	expect(sameContent([paragraph("x", { localId: "1" })], [paragraph("x")])).toBe(true);
	expect(sameContent([paragraph("x")], [paragraph("y")])).toBe(false);
});

test("pulled code blocks that plugins would run as JavaScript become plain text", () => {
	const source =
		"```dataviewjs\ndv.paragraph(app.vault.getName())\n```\n\n```ts\nconst safe = 1;\n```\n\nInline `$= dv.current()` query.\n";
	const markdown = adfToMergeMarkdown(parseMarkdownToADF(source, BASE_URL), BASE_URL);
	expect(markdown).toContain("```text\ndv.paragraph");
	expect(markdown).toContain("```ts\nconst safe = 1;");
	expect(markdown).toContain("`$ = dv.current()`");
	expect(markdown).not.toContain("dataviewjs");
});

test("neutralizes executable fences regardless of case, fence style or indentation", () => {
	expect(neutralizeExecutableMarkdown("~~~~ DataviewJS\nx\n~~~~")).toBe("~~~~text\nx\n~~~~");
	expect(neutralizeExecutableMarkdown("  ```js-engine\nx\n  ```")).toBe("  ```text\nx\n  ```");
	expect(neutralizeExecutableMarkdown("```dataview\nLIST\n```")).toBe("```dataview\nLIST\n```");
});
