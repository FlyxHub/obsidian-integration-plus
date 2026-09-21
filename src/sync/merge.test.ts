import { expect, test } from "@effect/vitest";
import { hasConflictMarkers, mergeThreeWay, mergeTwoWay, splitFrontmatter } from "./merge";

const base = "# Plan\n\nIntro.\n\nMiddle.\n\nOutro.\n";

test("applies a Confluence-only change", () => {
	const remote = base.replace("Outro.", "Outro, edited in Confluence.");
	expect(mergeThreeWay(base, base, remote)).toEqual({ text: remote, conflicts: 0 });
});

test("keeps a local-only change", () => {
	const local = base.replace("Intro.", "Intro, edited in Obsidian.");
	expect(mergeThreeWay(local, base, base)).toEqual({ text: local, conflicts: 0 });
});

test("combines changes to different blocks", () => {
	const local = base.replace("Intro.", "Local intro.");
	const remote = base.replace("Outro.", "Remote outro.");
	expect(mergeThreeWay(local, base, remote)).toEqual({
		text: "# Plan\n\nLocal intro.\n\nMiddle.\n\nRemote outro.\n",
		conflicts: 0,
	});
});

test("keeps Obsidian-only syntax that Confluence never sees", () => {
	const local = "# Plan\n\n```mermaid\ngraph TD; A-->B\n```\n\nIntro.\n\nOutro.\n";
	const published = '# Plan\n\n```adf\n{"type":"mediaSingle"}\n```\n\nIntro.\n\nOutro.\n';
	const remote = published.replace("Outro.", "Remote outro.");
	const merged = mergeThreeWay(local, published, remote);
	expect(merged.conflicts).toBe(0);
	expect(merged.text).toContain("```mermaid");
	expect(merged.text).toContain("Remote outro.");
});

test("marks overlapping changes as conflicts", () => {
	const local = base.replace("Middle.", "Local middle.");
	const remote = base.replace("Middle.", "Remote middle.");
	const merged = mergeThreeWay(local, base, remote);
	expect(merged.conflicts).toBe(1);
	expect(merged.text).toContain(
		"<<<<<<< Obsidian\nLocal middle.\n=======\nRemote middle.\n>>>>>>> Confluence",
	);
	expect(hasConflictMarkers(merged.text)).toBe(true);
});

test("treats identical changes on both sides as no conflict", () => {
	const both = base.replace("Middle.", "Same fix.");
	expect(mergeThreeWay(both, base, both)).toEqual({ text: both, conflicts: 0 });
});

test("two-way merge marks every difference and applies nothing", () => {
	const merged = mergeTwoWay("A\n\nB\n", "A\n\nC\n");
	expect(merged.conflicts).toBe(1);
	expect(merged.text).toBe("A\n\n<<<<<<< Obsidian\nB\n=======\nC\n>>>>>>> Confluence\n");
});

test("two-way merge of identical text is a no-op", () => {
	expect(mergeTwoWay("A\n", "A\n")).toEqual({ text: "A\n", conflicts: 0 });
});

test("splits frontmatter and normalizes line endings", () => {
	expect(splitFrontmatter("---\r\na: 1\r\n---\r\nBody\r\n")).toEqual({
		frontmatter: "---\na: 1\n---\n",
		body: "Body\n",
	});
	expect(splitFrontmatter("No frontmatter\n")).toEqual({
		frontmatter: "",
		body: "No frontmatter\n",
	});
});

test("detects conflict markers only when both ends are present", () => {
	expect(hasConflictMarkers("text\n=======\nmore")).toBe(false);
	expect(hasConflictMarkers("<<<<<<< Obsidian\na\n=======\nb\n>>>>>>> Confluence\n")).toBe(true);
});
