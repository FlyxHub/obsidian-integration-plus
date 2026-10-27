import { expect, test } from "@effect/vitest";
import { confluencePageId } from "./importPageInput";

test("parses numeric page IDs without losing precision", () => {
	expect(confluencePageId(" 123456789 ")).toBe("123456789");
	expect(confluencePageId("9007199254740993")).toBe("9007199254740993");
});

test("parses Confluence browser URLs", () => {
	expect(
		confluencePageId("https://example.atlassian.net/wiki/spaces/ABC/pages/123456789/Page+Title"),
	).toBe("123456789");
	expect(
		confluencePageId("https://example.atlassian.net/wiki/spaces/ABC/pages/123?x=y#heading"),
	).toBe("123");
});

test("rejects invalid IDs and URLs", () => {
	for (const input of [
		"",
		"abc",
		"-123",
		"12.3",
		"/pages/123",
		"https://example.atlassian.net/wiki",
		"https://example.atlassian.net/pages/123abc",
		"ftp://example.com/pages/123",
	])
		expect(confluencePageId(input)).toBeUndefined();
});
