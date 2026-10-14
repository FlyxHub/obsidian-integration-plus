import { expect, test } from "@effect/vitest";
import {
	createLinkTextIndex,
	createPageLinkResolver,
	pageLinkTarget,
	rewritePageLinks,
} from "./pageLinks";

const SITE = "https://example.atlassian.net";
const url = (id: string, title = "Page") => `${SITE}/wiki/spaces/IT/pages/${id}/${title}`;
const resolve = createPageLinkResolver(
	new Map([
		["1", "Docs/Local Admin Access.md"],
		["2", "Docs/Team/Onboarding.md"],
		["3", "Archive/Onboarding.md"],
	]),
	["Docs/Local Admin Access.md", "Docs/Team/Onboarding.md", "Archive/Onboarding.md"],
);
const rewrite = (markdown: string) => rewritePageLinks(markdown, SITE, resolve);

test("turns links to pages with notes into wikilinks", () => {
	expect(rewrite(`See [Local Admin Access](${url("1")}).`).markdown).toBe(
		"See [[Local Admin Access]].",
	);
	expect(rewrite(`See [the admin page](${url("1")}).`).markdown).toBe(
		"See [[Local Admin Access|the admin page]].",
	);
});

test("uses the vault path when two notes share a name", () => {
	expect(rewrite(`[Onboarding](${url("2")})`).markdown).toBe("[[Docs/Team/Onboarding|Onboarding]]");
	expect(createLinkTextIndex(["Docs/Team/Onboarding.md"])("Docs/Team/Onboarding.md")).toBe(
		"Onboarding",
	);
});

test("turns smart links and relative links into wikilinks", () => {
	expect(rewrite(`Card: [${url("1")}](${url("1")})`).markdown).toBe("Card: [[Local Admin Access]]");
	expect(rewrite("[rel](/wiki/spaces/IT/pages/1)").markdown).toBe("[[Local Admin Access|rel]]");
});

test("keeps the heading from a Confluence anchor", () => {
	expect(rewrite(`[steps](${url("1")}#Steps-to-follow)`).markdown).toBe(
		"[[Local Admin Access#Steps to follow|steps]]",
	);
});

test("escapes the alias separator inside tables", () => {
	expect(rewrite(`| Page | [admin](${url("1")}) |`).markdown).toBe(
		"| Page | [[Local Admin Access\\|admin]] |",
	);
});

test("leaves other links, code and adf fences alone, and reports unlinked pages", () => {
	const markdown = [
		"[Google](https://google.com) and [missing](" + url("99") + ")",
		"`[code](" + url("1") + ")`",
		"```adf",
		`{"href":"${url("1")}"}`,
		"```",
		"> ```",
		`> [in quoted fence](${url("1")})`,
		"> ```",
		"[short link](https://example.atlassian.net/wiki/x/AbCd)",
		"[other site](https://other.atlassian.net/wiki/spaces/IT/pages/1/X)",
	].join("\n");
	const result = rewrite(markdown);
	expect(result.markdown).toBe(markdown);
	expect(result.unresolved).toEqual(["99"]);
});

test("keeps the web link when the text can't be a wikilink alias", () => {
	const markdown = `[a | b](${url("1")})`;
	expect(rewrite(markdown).markdown).toBe(markdown);
});

test("only treats page URLs on the configured site as page links", () => {
	expect(pageLinkTarget(url("1"), SITE)).toEqual({ pageId: "1", anchor: "" });
	expect(pageLinkTarget("123", SITE)).toBeUndefined();
	expect(pageLinkTarget("javascript:alert(1)", SITE)).toBeUndefined();
});

test("keeps the web link when the heading anchor could break out of the wikilink", () => {
	const injected = [
		"#x%5D%5D%0A%0A%60%60%60dataviewjs%0Adv.span%60pwn%60%0A%60%60%60",
		"#x%5D%5D%20%21%5B%5Bsecret.md%5D%5D",
		"#a%7Cb",
	];
	for (const anchor of injected) {
		const link = `[click](${url("1")}${anchor})`;
		expect(rewrite(link).markdown).toBe(link);
	}
	expect(rewrite(`[click](${url("1")}#Getting-started)`).markdown).toBe(
		"[[Local Admin Access#Getting started|click]]",
	);
});

test("leaves images and escaped brackets that point to pages alone", () => {
	for (const text of [`![](${url("1")})`, `\\[x](${url("1")})`])
		expect(rewrite(text).markdown).toBe(text);
	// An escaped `!` is text before a link, and an escaped backslash is text before one.
	expect(rewrite(`Wow\\![x](${url("1")})`).markdown).toBe("Wow\\![[Local Admin Access|x]]");
	expect(rewrite(`\\\\[x](${url("1")})`).markdown).toBe("\\\\[[Local Admin Access|x]]");
});
