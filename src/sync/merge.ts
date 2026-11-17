import { diff3Merge, diffComm } from "node-diff3";

const LOCAL_LABEL = "Obsidian";
const REMOTE_LABEL = "Confluence";
const START = `<<<<<<< ${LOCAL_LABEL}`;
const MIDDLE = "=======";
const END = `>>>>>>> ${REMOTE_LABEL}`;

export interface MergeOutcome {
	text: string;
	/** Conflicts written with markers. */
	conflicts: number;
	/** Conflicts resolved by taking Confluence's lines, with `preferRemote`. */
	overwritten: number;
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
 * conflict markers, or with `preferRemote` take Confluence's lines.
 */
export function mergeThreeWay(
	local: string,
	base: string,
	remote: string,
	preferRemote = false,
): MergeOutcome {
	const regions = diff3Merge(lines(local), lines(base), lines(remote), {
		excludeFalseConflicts: true,
	});
	const merge = new ConflictWriter(preferRemote);
	for (const region of regions) {
		if (region.ok) merge.output.push(...region.ok);
		else if (region.conflict) merge.conflict(region.conflict.a, region.conflict.b);
	}
	return merge.outcome();
}

/**
 * Two-way comparison for notes with no recorded base. Nothing is applied automatically:
 * every difference becomes a conflict for the user to resolve, or with `preferRemote`
 * takes Confluence's lines.
 */
export function mergeTwoWay(local: string, remote: string, preferRemote = false): MergeOutcome {
	const merge = new ConflictWriter(preferRemote);
	for (const part of diffComm(lines(local), lines(remote))) {
		if (part.common) {
			merge.output.push(...part.common);
			continue;
		}
		if (part.buffer1.length === 0 && part.buffer2.length === 0) continue;
		merge.conflict(part.buffer1, part.buffer2);
	}
	return merge.outcome();
}

class ConflictWriter {
	readonly output: string[] = [];
	private conflicts = 0;
	private overwritten = 0;

	constructor(private readonly preferRemote: boolean) {}

	conflict(local: readonly string[], remote: readonly string[]) {
		if (this.preferRemote) {
			this.overwritten++;
			this.output.push(...remote);
			return;
		}
		this.conflicts++;
		this.output.push(START, ...local, MIDDLE, ...remote, END);
	}

	outcome(): MergeOutcome {
		return {
			text: joinLines(this.output),
			conflicts: this.conflicts,
			overwritten: this.overwritten,
		};
	}
}

/**
 * True when the text still contains a merge conflict marker. One left over from a partly
 * resolved conflict counts too. `=======` alone doesn't, because it's also a heading underline.
 */
export function hasConflictMarkers(text: string): boolean {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.some((line) => line === START || line === END);
}

/** True when two texts have the same lines, ignoring line endings and trailing newlines. */
export function sameLines(left: string, right: string): boolean {
	return joinLines(lines(left)) === joinLines(lines(right));
}

function lines(text: string): string[] {
	const normalized = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
	return normalized === "" ? [] : normalized.split("\n");
}

function joinLines(output: string[]): string {
	return output.length === 0 ? "" : `${output.join("\n")}\n`;
}
