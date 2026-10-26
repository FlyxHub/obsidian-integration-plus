import { expect, test } from "@effect/vitest";
import {
	ConfluenceUploadSettings,
	MarkdownConfluencePlatformLive,
	MarkdownWorkspaceService,
	Publisher,
	parseMarkdownToADF,
	type MarkdownFile,
	type MarkdownWorkspace,
	type RequiredConfluenceClient,
} from "@markdown-confluence/lib";
import { Effect } from "effect";
import { independentNotes, publishKeepingParents } from "./keepParentPublish";
import { notesForPartialPublish } from "./partialPublish";

const settings = {
	...ConfluenceUploadSettings.DEFAULT_SETTINGS,
	confluenceBaseUrl: "https://example.atlassian.net",
	confluenceParentId: "100",
};
const pinned = { "connie-page-id": "123", "connie-dont-change-parent-page": true };
const file = (path: string, frontmatter: Record<string, unknown> = {}): MarkdownFile => ({
	absoluteFilePath: path,
	fileName: path.split("/").pop()!,
	folderName: "",
	pageTitle: path.split("/").pop()!.replace(/\.md$/, ""),
	contents: "Updated content.",
	frontmatter,
});

function fixture(files: MarkdownFile[]) {
	const lookups: string[] = [];
	const writes: string[] = [];
	const updates: Record<string, unknown>[] = [];
	const binaryReads: { search: string; from: string }[] = [];
	const page = (id: string) => ({
		id,
		type: "page",
		title: id === "100" ? "Publish root" : "PI20 - Sprint 4",
		space: { key: "TEST" },
		version: { number: 1, by: { accountId: "me" } },
		// The moved page is outside the configured tree; its direct ID remains valid.
		ancestors: [{ id: "999" }],
		body: {
			atlas_doc_format: {
				value: JSON.stringify(parseMarkdownToADF("Old content.", settings.confluenceBaseUrl)),
			},
		},
	});
	const client = {
		users: { getCurrentUser: async () => ({ accountId: "me" }) },
		content: {
			getContentById: async ({ id }: { id: string }) => page(id),
			getContent: async ({ title }: { title: string }) => {
				lookups.push(title);
				return { results: [{ ...page("456"), title }] };
			},
			createContent: async () => {
				throw new Error("Should not create ancestor pages");
			},
			updateContent: async (update: Record<string, unknown>) => {
				updates.push(update);
				return {};
			},
		},
		contentAttachments: { getAttachments: async () => ({ results: [] }) },
		contentLabels: { getLabelsForContent: async () => ({ results: [] }) },
	} as unknown as RequiredConfluenceClient;
	const workspace: MarkdownWorkspace = {
		getMarkdownFilesToUpload: Effect.sync(() => structuredClone(files)),
		updateMarkdownValues: (path) =>
			Effect.sync(() => {
				writes.push(path);
			}),
		loadMarkdownFile: () => Effect.fail(new Error("Unexpected note load")),
		readBinary: (search, from) =>
			Effect.sync(() => {
				binaryReads.push({ search, from });
				return false;
			}),
		readText: () => Effect.succeed(false),
	};
	const publisher = new Publisher(settings, client, []);
	const run = (filter?: string, adapted = true) =>
		Effect.runPromise(
			(adapted ? publishKeepingParents(publisher, filter) : publisher.publishEffect(filter)).pipe(
				Effect.provideService(MarkdownWorkspaceService, workspace),
				Effect.provide(MarkdownConfluencePlatformLive),
			),
		);
	return { run, lookups, writes, updates, binaryReads, workspace, publisher };
}

test("reproduces the PI20 error in the unadapted library", async () => {
	const { run, lookups } = fixture([
		file("/Delivery/Other.md", { "connie-page-id": "124" }),
		file("/Delivery/PI20/PI20 - Sprint 4.md", pinned),
	]);
	await expect(run("/Delivery/PI20/PI20 - Sprint 4.md", false)).rejects.toThrow(
		"PI20 is trying to overwrite a page outside the page tree",
	);
	expect(lookups).toEqual(["PI20"]);
});

test.each(["current", "all", "changes"])(
	"%s publish keeps the moved page and never resolves PI20",
	async (mode) => {
		const path = "/Delivery/PI20/PI20 - Sprint 4.md";
		const files = [file("/Delivery/Other.md", { "connie-page-id": "124" }), file(path, pinned)];
		const independent = independentNotes(
			files.map((f) => ({ path: f.absoluteFilePath, frontmatter: f.frontmatter })),
		);
		const selection = notesForPartialPublish(
			files.map((f) => f.absoluteFilePath),
			[path],
			independent,
		);
		const selectedFiles =
			mode === "changes" ? files.filter((f) => selection?.includes(f.absoluteFilePath)) : files;
		const { run, lookups, writes, updates } = fixture(selectedFiles);
		const results = await run(mode === "current" ? path : undefined);
		const result = results.find((entry) => entry.node.file.absoluteFilePath === path);
		expect(result?.reason).toBeUndefined();
		expect(result?.successfulUploadResult?.adfFile.absoluteFilePath).toBe(path);
		expect(result?.successfulUploadResult?.adfFile.fileName).toBe("PI20 - Sprint 4.md");
		expect(result?.successfulUploadResult?.adfFile.pageTitle).toBe("PI20 - Sprint 4");
		expect(lookups).toEqual([]);
		expect(writes).toContain(path);
		expect(writes.some((p) => p.includes("__connie_page_"))).toBe(false);
		const update = updates.find((entry) => entry["id"] === "123");
		expect(update).toBeDefined();
		expect(update).not.toHaveProperty("ancestors");
	},
);

test("ordinary notes still enforce the configured page tree", async () => {
	const { run } = fixture([
		file("/Delivery/Other.md", { "connie-page-id": "124" }),
		file("/Delivery/PI20/New.md"),
	]);
	await expect(run()).rejects.toThrow("PI20 is trying to overwrite a page outside the page tree");
});

test("keep-parent folder notes remain ancestors for ordinary child notes", () => {
	const files = [
		{ path: "Delivery/PI20/PI20.md", frontmatter: pinned },
		{ path: "Delivery/PI20/New.md", frontmatter: {} },
	];
	expect([...independentNotes(files)]).toEqual([]);
	expect([...independentNotes(files.slice(0, 1))]).toEqual(["Delivery/PI20/PI20.md"]);
});

test("keep-parent without a valid page ID still uses the ordinary tree", () => {
	const files = [undefined, "", "bad", false].map((id, index) => ({
		path: `Delivery/PI20/Note ${index}.md`,
		frontmatter: { ...pinned, "connie-page-id": id },
	}));
	expect([...independentNotes(files)]).toEqual([]);
});

test("relative image reads use the real source folder after tree flattening", async () => {
	const path = "/Delivery/PI20/PI20 - Sprint 4.md";
	const note = { ...file(path, pinned), contents: "![Image](./diagram.png)" };
	const { run, binaryReads } = fixture([
		file("/Delivery/Other.md", { "connie-page-id": "124" }),
		note,
	]);
	const results = await run(path);
	expect(results[0]?.reason).toBeUndefined();
	expect(binaryReads.length).toBeGreaterThan(0);
	for (const read of binaryReads) expect(read.from).toBe(path);
	expect(binaryReads.some((read) => read.search.includes("diagram.png"))).toBe(true);
});

test("virtual names do not collide with actual notes and their titles are preserved", async () => {
	const path = "/Delivery/PI20/PI20 - Sprint 4.md";
	const files = [
		file("/Delivery/__connie_page_123.md", { "connie-page-id": "124" }),
		file(path, { ...pinned, "connie-title": "Custom sprint title" }),
	];
	const { run, updates } = fixture(files);
	const results = await run(path);
	expect(results).toHaveLength(1);
	expect(results[0]?.node.file.absoluteFilePath).toBe(path);
	expect(updates.find((update) => update["id"] === "123")?.["title"]).toBe("Custom sprint title");
});

test("mixed publishes keep an existing folder note as parent of ordinary child pages", async () => {
	const { run, lookups, updates } = fixture([
		file("/Delivery/Other.md", { "connie-page-id": "125" }),
		file("/Delivery/PI20/PI20.md", pinned),
		file("/Delivery/PI20/Child.md", { "connie-page-id": "124" }),
	]);
	const results = await run();
	expect(results.every((result) => result.successfulUploadResult !== undefined)).toBe(true);
	expect(lookups).toEqual([]);
	expect(updates.find((update) => update["id"] === "124")?.["ancestors"]).toEqual([{ id: "123" }]);
	expect(updates.find((update) => update["id"] === "123")).not.toHaveProperty("ancestors");
});
