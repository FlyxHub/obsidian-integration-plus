import { createFenceTracker } from "./fences";

/** `> [!type]` with no title, collapse marker, or text after it. */
const CALLOUT_WITHOUT_TITLE = /^(\s*>\s*)\[!([^\]]+)\]\s*$/;
const QUOTED_LINE = /^\s*>\s?(.*)$/;
const NOT_PARAGRAPH = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,}|\||<|\[!)/;
const THEMATIC_BREAK = /^(-{3,}|\*{3,}|_{3,})$/;

/**
 * Prepare Obsidian callouts for the publisher.
 *
 * The publisher turns a callout's title, or its capitalized type when there is no title,
 * into the first line of the Confluence panel, so `> [!warning]` published a panel that
 * starts with the word "Warning". Confluence panels show their type with an icon, so a
 * callout without a title now publishes only its body: its first body line moves up into
 * the title position, which the publisher uses as the start of the panel's text.
 * Callouts with a title, collapsible callouts, and callouts whose body doesn't start with a
 * paragraph are left unchanged.
 */
export function normalizeCalloutsForPublish(markdown: string): string {
	const lines = markdown.split("\n");
	const output: string[] = [];
	const inCode = createFenceTracker();
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		const callout = inCode(line) ? null : CALLOUT_WITHOUT_TITLE.exec(line);
		const next = lines[index + 1];
		const firstBodyLine = callout && next !== undefined ? QUOTED_LINE.exec(next)?.[1] : undefined;
		if (callout && firstBodyLine !== undefined && isParagraphText(firstBodyLine)) {
			output.push(`${callout[1]}[!${callout[2]}] ${firstBodyLine.trim()}`);
			index++;
			continue;
		}
		output.push(line);
	}
	return output.join("\n");
}

function isParagraphText(text: string): boolean {
	const trimmed = text.trim();
	return trimmed !== "" && !NOT_PARAGRAPH.test(trimmed) && !THEMATIC_BREAK.test(trimmed);
}
