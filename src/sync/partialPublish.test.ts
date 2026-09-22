import { expect, test } from "@effect/vitest";
import { MarkdownWorkspaceService, type MarkdownFile } from "@markdown-confluence/lib";
import { Effect, Layer } from "effect";
import { notesForPartialPublish, partialWorkspace, treeRoot } from "./partialPublish";

const vault = [
	"Docs/Docs.md",
	"Docs/Intro.md",
	"Docs/Team/Team.md",
	"Docs/Team/Onboarding.md",
	"Docs/Team/Deep/index.md",
	"Docs/Team/Deep/Page.md",
	"Docs/Guides/Setup.md",
];

test("finds the root folder like the lib does", () => {
	expect(treeRoot(vault)).toBe("Docs");
	expect(treeRoot(["Docs/A.md"])).toBe("Docs");
	expect(treeRoot(["A.md", "B.md"])).toBe("");
	expect(treeRoot(["Docs/Team/A.md", "Docs/Team/B.md"])).toBe("Docs/Team");
});

test("includes the folder notes on the way to a changed note, and keeps the root", () => {
	const selected = notesForPartialPublish(vault, ["Docs/Team/Deep/Page.md"]);
	expect(selected?.sort()).toEqual(
		[
			"Docs/Team/Deep/Page.md",
			"Docs/Team/Deep/index.md",
			"Docs/Team/Team.md",
			"Docs/Docs.md",
		].sort(),
	);
	expect(treeRoot(selected!)).toBe(treeRoot(vault));
});

test("adds a note from another branch when the root folder has no folder note", () => {
	const noRootNote = vault.filter((path) => path !== "Docs/Docs.md");
	const selected = notesForPartialPublish(noRootNote, ["Docs/Team/Onboarding.md"]);
	expect(selected).toContain("Docs/Intro.md");
	expect(treeRoot(selected!)).toBe("Docs");
});

test("adds nothing for notes that aren't published", () => {
	expect(notesForPartialPublish(vault, ["Elsewhere/Note.md"])).toEqual([]);
});

test("the partial workspace hands the lib only the selected notes, in their order", async () => {
	const file = (path: string): MarkdownFile => ({
		folderName: "",
		absoluteFilePath: `/${path}`,
		fileName: path.split("/").pop()!,
		contents: "",
		pageTitle: path,
		frontmatter: {},
	});
	const fullWorkspace = Layer.succeed(MarkdownWorkspaceService, {
		getMarkdownFilesToUpload: Effect.succeed(vault.map(file)),
	} as unknown as MarkdownWorkspaceService["Service"]);
	const files = await Effect.runPromise(
		Effect.gen(function* () {
			const workspace = yield* MarkdownWorkspaceService;
			return yield* workspace.getMarkdownFilesToUpload;
		}).pipe(
			Effect.provide(
				partialWorkspace(new Set(notesForPartialPublish(vault, ["Docs/Guides/Setup.md"]))).pipe(
					Layer.provide(fullWorkspace),
				),
			),
		),
	);
	expect(files.map((entry) => entry.absoluteFilePath)).toEqual([
		"/Docs/Docs.md",
		"/Docs/Guides/Setup.md",
	]);
});
