/** An opening or closing code fence, also inside blockquotes and callouts. */
const FENCE = /^\s*(?:>\s?)*(`{3,}|~{3,})/;

/**
 * Tracks fenced code blocks while reading Markdown line by line. The returned function takes
 * each line in order and returns true for fence lines and the code between them, which
 * Markdown rewrites must leave alone.
 */
export function createFenceTracker(): (line: string) => boolean {
	let open: string | undefined;
	return (line) => {
		const marker = FENCE.exec(line)?.[1];
		if (!marker) return open !== undefined;
		if (!open) open = marker;
		else if (marker[0] === open[0] && marker.length >= open.length) open = undefined;
		return true;
	};
}

/**
 * Rewrite Markdown outside code: fenced blocks and inline code are left alone, and `rewrite`
 * gets each other segment of a line, with the whole line.
 */
export function mapOutsideCode(
	markdown: string,
	rewrite: (text: string, line: string) => string,
): string {
	const inCode = createFenceTracker();
	return markdown
		.split("\n")
		.map((line) =>
			inCode(line)
				? line
				: // Odd segments of a backtick split are inline code.
					line
						.split("`")
						.map((segment, index) => (index % 2 === 1 ? segment : rewrite(segment, line)))
						.join("`"),
		)
		.join("\n");
}
