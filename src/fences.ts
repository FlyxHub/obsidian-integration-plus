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
