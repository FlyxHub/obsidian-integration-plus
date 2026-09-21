import { diff3Merge, diffComm } from "node-diff3";

export const LOCAL_LABEL = "Obsidian";
export const REMOTE_LABEL = "Confluence";
const START = `<<<<<<< ${LOCAL_LABEL}`;
const MIDDLE = "=======";
const END = `>>>>>>> ${REMOTE_LABEL}`;

export interface MergeOutcome {
	text: string;
	conflicts: number;
}

export interface SplitNote {
	/** The frontmatter block including both `---` lines and the trailing newline, or "". */
	frontmatter: string;
	body: string;
}

/** Separate YAML frontmatter from the note body. Line endings are normalized to `\n`. */
export function splitFrontmatter(text: string): SplitNote {
	const normalized = text.replace(/\r\n?/g, "\n");
	const match = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(normalized);
	if (!match) return { frontmatter: "", body: normalized };
	return { frontmatter: match[0], body: normalized.slice(match[0].length) };
}

/**
 * Three-way merge of a note body with the Confluence version, like `git merge`.
 * `base` is the Confluence content at the last publish or pull, in the same Markdown form
 * as `remote`. Changes on only one side are applied; overlapping changes get Git-style
 * conflict markers.
 */
export function mergeThreeWay(local: string, base: string, remote: string): MergeOutcome {
	const regions = diff3Merge(lines(local), lines(base), lines(remote), {
		excludeFalseConflicts: true,
	});
	const output: string[] = [];
	let conflicts = 0;
	for (const region of regions) {
		if (region.ok) output.push(...region.ok);
		else if (region.conflict) {
			conflicts++;
			output.push(START, ...region.conflict.a, MIDDLE, ...region.conflict.b, END);
		}
	}
	return { text: joinLines(output), conflicts };
}

/**
 * Two-way comparison for notes with no recorded base. Nothing is applied automatically:
 * every difference becomes a conflict for the user to resolve.
 */
export function mergeTwoWay(local: string, remote: string): MergeOutcome {
	const output: string[] = [];
	let conflicts = 0;
	for (const part of diffComm(lines(local), lines(remote))) {
		if (part.common) {
			output.push(...part.common);
			continue;
		}
		if (part.buffer1.length === 0 && part.buffer2.length === 0) continue;
		conflicts++;
		output.push(START, ...part.buffer1, MIDDLE, ...part.buffer2, END);
	}
	return { text: joinLines(output), conflicts };
}

/** True when the text still contains merge conflict markers. */
export function hasConflictMarkers(text: string): boolean {
	const markerLines = text.replace(/\r\n?/g, "\n").split("\n");
	return markerLines.some((line) => line === START) && markerLines.some((line) => line === END);
}

function lines(text: string): string[] {
	const normalized = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
	return normalized === "" ? [] : normalized.split("\n");
}

function joinLines(output: string[]): string {
	return output.length === 0 ? "" : `${output.join("\n")}\n`;
}
