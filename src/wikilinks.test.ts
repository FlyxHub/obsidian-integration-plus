import { expect, test } from "@effect/vitest";
import { wikilinksToPageLinks } from "./wikilinks";

const URL = "https://example.atlassian.net/wiki/spaces/DOC/pages/42";
const lookup = (linkpath: string) => (linkpath === "Other" ? `${URL}/` : undefined);

test("turns wikilinks to published notes into page links", () => {
	expect(wikilinksToPageLinks("See [[Other]] and [[Other|the other note]].", lookup)).toBe(
		`See [${URL}](${URL}) and [the other note](${URL}).`,
	);
	expect(wikilinksToPageLinks("| [[Other#Some heading\\|x]] |", lookup)).toBe(
		`| [x](${URL}#Some-heading) |`,
	);
});

test("leaves embeds, unpublished notes, same-page links and code alone", () => {
	const text = "![[Other]] [[Missing]] [[#Heading]] `[[Other]]`\n```\n[[Other]]\n```";
	expect(wikilinksToPageLinks(text, lookup)).toBe(text);
});
