import { createFenceTracker } from "./fences";
import type { ImageSize } from "./imageSize";
import { decodeLink, hasUrlScheme } from "./paths";

/** Returns the size of the image a note links to, or undefined if it can't be read. */
export type ImageSizeLookup = (link: string) => Promise<ImageSize | undefined>;

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp)$/i;
const WIKI_EMBED = /!\[\[([^\]|#\n]+?)((?:\|[^\]\n]*)?)\]\]/g;
const MARKDOWN_EMBED = /!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?)\)/g;
const SIZE = /^(\d+)(?:x(\d+))?$/;

/**
 * Give each local image embed an explicit width and height before publishing, so Confluence
 * shows it at the size Obsidian does.
 *
 * The publisher sizes an image by its pixel dimensions, so a large screenshot fills the
 * whole page. Images wider than `maxWidth` (0 for no limit) are scaled down to it. A width
 * set in the note, as in `![[image.png|400]]`, gets the height that keeps the image's aspect
 * ratio; the publisher would otherwise keep the full height and stretch the image. Sizes set
 * as `WIDTHxHEIGHT`, images that can't be read, and code are left alone.
 */
export async function sizeImageEmbeds(
	markdown: string,
	lookup: ImageSizeLookup,
	maxWidth: number,
): Promise<string> {
	const sizeFor = async (link: string, sizeText: string | undefined) => {
		const requested = SIZE.exec(sizeText?.trim() ?? "");
		if (requested?.[2] || !IMAGE_EXTENSION.test(link)) return undefined;
		const natural = await lookup(link);
		if (!natural) return undefined;
		const width = requested
			? Number(requested[1])
			: maxWidth > 0 && natural.width > maxWidth
				? maxWidth
				: undefined;
		if (!width) return undefined;
		return `${width}x${Math.max(1, Math.round((width * natural.height) / natural.width))}`;
	};

	const inCode = createFenceTracker();
	const lines: string[] = [];
	for (const line of markdown.split("\n")) {
		if (inCode(line) || !line.includes("![")) {
			lines.push(line);
			continue;
		}
		// Odd segments of a backtick split are inline code.
		const segments = line.split("`");
		for (let index = 0; index < segments.length; index += 2) {
			let segment = segments[index]!;
			segment = await replaceAsync(segment, WIKI_EMBED, async (embed, link, options) => {
				const size = await sizeFor(link, options.split("|").at(-1));
				return size ? `![[${link}|${size}]]` : embed;
			});
			segment = await replaceAsync(segment, MARKDOWN_EMBED, async (embed, alt, url, title) => {
				const link = url.replace(/^<|>$/g, "");
				if (hasUrlScheme(link)) return embed;
				const parts = alt.split("|");
				const sizeText = parts.length > 1 ? parts.at(-1) : undefined;
				const size = await sizeFor(decodeLink(link), sizeText);
				if (!size) return embed;
				const text = sizeText === undefined ? alt : parts.slice(0, -1).join("|");
				return `![${text}|${size}](${url}${title})`;
			});
			segments[index] = segment;
		}
		lines.push(segments.join("`"));
	}
	return lines.join("\n");
}

async function replaceAsync(
	text: string,
	pattern: RegExp,
	replace: (match: string, ...groups: string[]) => Promise<string>,
): Promise<string> {
	const matches = [...text.matchAll(pattern)];
	if (matches.length === 0) return text;
	const replacements = await Promise.all(
		matches.map((match) => replace(match[0], ...match.slice(1).map((group) => group ?? ""))),
	);
	let result = "";
	let last = 0;
	matches.forEach((match, index) => {
		result += text.slice(last, match.index) + replacements[index]!;
		last = match.index + match[0].length;
	});
	return result + text.slice(last);
}
