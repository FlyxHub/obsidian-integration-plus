import { parseMarkdownToADF, type PublisherFunctions } from "@markdown-confluence/lib";
import { describe, expect, it } from "vitest";
import "./markdownIt";
import { pageUrlsById, restoreSmartLinkUrls } from "./smartLinks";

const site = "https://x.atlassian.net";
const personal = `${site}/wiki/spaces/~abc123/pages/42/`;

describe("restoreSmartLinkUrls", () => {
	it("keeps the ~ of a personal space that the lib drops", () => {
		const url = personal.replace(/\/$/, "");
		const adf = parseMarkdownToADF(
			`- [${url}](${url})\n- [${site}/wiki/spaces/KB/pages/7](${site}/wiki/spaces/KB/pages/7)\n`,
			site,
		);
		const plugin = restoreSmartLinkUrls(pageUrlsById([personal, "not a url"]));
		const loaded = plugin.load(adf, null, {} as PublisherFunctions);
		const urls = JSON.stringify(loaded).match(/"url":"[^"]+"/g);
		expect(urls).toEqual([`"url":"${url}"`, `"url":"${site}/wiki/spaces/KB/pages/7"`]);
	});
});
