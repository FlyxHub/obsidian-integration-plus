import { expect, test } from "@effect/vitest";
import { createPageLinkResolver, linkTextFor, pageLinkTarget, rewritePageLinks } from "./pageLinks";

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
	expect(linkTextFor("Docs/Team/Onboarding.md", ["Docs/Team/Onboarding.md"])).toBe("Onboarding");
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
