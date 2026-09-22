import { expect, test } from "@effect/vitest";
import { sizeImageEmbeds } from "./imageEmbeds";

const sizes: Record<string, { width: number; height: number }> = {
	"big.png": { width: 2400, height: 1200 },
	"small.png": { width: 300, height: 200 },
	"images/My shot.jpg": { width: 1000, height: 500 },
};
const lookup = async (link: string) => sizes[link];
const size = (markdown: string, maxWidth = 700) => sizeImageEmbeds(markdown, lookup, maxWidth);

test("scales down images wider than the maximum, keeping the aspect ratio", async () => {
	expect(await size("![[big.png]]")).toBe("![[big.png|700x350]]");
	expect(await size("![shot](images/My%20shot.jpg)")).toBe("![shot|700x350](images/My%20shot.jpg)");
});

test("leaves images within the maximum, and all images when there's no limit", async () => {
	expect(await size("![[small.png]]")).toBe("![[small.png]]");
	expect(await size("![[big.png]]", 0)).toBe("![[big.png]]");
});

test("gives a width set in the note the matching height", async () => {
	expect(await size("![[big.png|400]]")).toBe("![[big.png|400x200]]");
	expect(await size("![[small.png|600]]")).toBe("![[small.png|600x400]]");
	expect(await size("![alt text|400](big.png)")).toBe("![alt text|400x200](big.png)");
});

test("leaves explicit sizes, unknown files, web images, other files and code alone", async () => {
	const unchanged = [
		"![[big.png|500x100]]",
		"![[missing.png]]",
		"![[Some note]]",
		"![remote](https://example.com/big.png)",
		"`![[big.png]]`",
		"```\n![[big.png]]\n```",
	];
	for (const markdown of unchanged) expect(await size(markdown)).toBe(markdown);
});

test("sizes every embed on a line and keeps the text around them", async () => {
	expect(await size("Before ![[big.png]] and ![[small.png|150]] after.")).toBe(
		"Before ![[big.png|700x350]] and ![[small.png|150x100]] after.",
	);
});
