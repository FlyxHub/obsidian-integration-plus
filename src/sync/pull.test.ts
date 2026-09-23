import { expect, test } from "@effect/vitest";
import { parseMarkdownToADF } from "@markdown-confluence/lib";
import { MERGE_FORMAT, adfToMergeMarkdown } from "./adfMarkdown";
import type { ConfluenceRemote, RemoteChild, RemotePage } from "./confluenceRemote";
import { HAS_CONFLICTS, NEEDS_PULL, checkBeforePublish, findChangedNotes } from "./publishGate";
import { isFolderNote } from "./partialPublish";
import { PullService, isGeneratedFolderPage, type PullVault } from "./pull";
import { MediaSync, safeFileName } from "./media";

/** Pull without attachments: nothing is downloaded and no media has a local copy. */
const NO_MEDIA = { ensure: async () => [], resolver: () => () => undefined };
import { toNoteName } from "./names";
import type { SyncBase, SyncStateStore } from "./syncState";

const BASE_URL = "https://example.atlassian.net";
const ME = "me";
const OPTIONS = { confluenceBaseUrl: BASE_URL, confluenceSiteUrl: BASE_URL };
const adf = (markdown: string) => parseMarkdownToADF(markdown, BASE_URL);
const folderPageAdf = {
	type: "doc",
	version: 1,
	content: [
		{
			type: "paragraph",
			content: [{ type: "inlineExtension", attrs: { extensionKey: "pagetree" } }],
		},
	],
};

function fakeRemote(pages: RemotePage[], children: Record<string, RemoteChild[]> = {}) {
	const byId = new Map(pages.map((page) => [page.id, page]));
	const remote: ConfluenceRemote = {
		currentAccountId: async () => ME,
		getPage: async (id) => byId.get(id),
		getVersions: async (ids) =>
			new Map(
				ids.flatMap((id) => {
					const page = byId.get(id);
					return page ? [[id, { version: page.version }] as const] : [];
				}),
			),
		listChildren: async (id) => children[id] ?? [],
	};
	return remote;
}

function page(id: string, markdown: string, version: number, extra: Partial<RemotePage> = {}) {
	return {
		id,
		title: `Page ${id}`,
		version,
		authorId: "someone",
		adf: adf(markdown),
		...extra,
	};
}

function fakeState(initial: SyncBase[] = []) {
	const bases = new Map(initial.map((base) => [base.pageId, base]));
	const media: Record<string, string> = {};
	const store: SyncStateStore = {
		get: async (id) => bases.get(id),
		set: async (base) => void bases.set(base.pageId, base),
		getMedia: async () => ({ ...media }),
		setMedia: async (map) => void Object.assign(media, map),
	};
	return { store, bases, media };
}

function fakeVault(files: Record<string, string>) {
	const frontmatter = new Map<string, Record<string, string>>();
	const vault: PullVault = {
		linkedNotes: () =>
			new Map(
				Object.entries(files).flatMap(([path, text]) => {
					const id = /connie-page-id: "?(\d+)/.exec(text)?.[1];
					return id ? [[id, path] as const] : [];
				}),
			),
		read: async (path) => files[path] ?? "",
		replace: async (path, expected, next) => {
			if (files[path] !== expected) throw new Error("changed");
			files[path] = next;
		},
		setFrontmatter: async (path, values) =>
			void frontmatter.set(path, { ...frontmatter.get(path), ...values }),
		notePaths: () => Object.keys(files),
		exists: (path) => path in files,
		create: async (path, body, values) => {
			files[path] = body;
			frontmatter.set(path, values);
		},
		fingerprint: async (path) => (path in files ? fingerprintOf(files[path]!) : undefined),
	};
	return { vault, files, frontmatter };
}

/** The fake vault's fingerprint: the note text itself, which is enough to compare. */
const fingerprintOf = (text: string) => `fp:${text}`;

const base = (id: string, markdown: string, version: number): SyncBase => ({
	pageId: id,
	version,
	title: `Page ${id}`,
	markdown: adfToMergeMarkdown(adf(markdown), BASE_URL),
	format: MERGE_FORMAT,
	unresolvedLinks: [],
	unresolvedMedia: [],
});

test("pull merges a Confluence edit into the note and keeps frontmatter and local-only syntax", async () => {
	const published = "Intro.\n\nOutro.\n";
	const note = '---\nconnie-page-id: "1"\n---\n```mermaid\ngraph TD\n```\n\nIntro.\n\nOutro.\n';
	const { vault, files } = fakeVault({ "Docs/Note.md": note });
	const { store, bases } = fakeState([base("1", published, 3)]);
	const remote = fakeRemote([page("1", "Intro.\n\nOutro, edited.\n", 4)]);

	const report = await new PullService(remote, vault, store, NO_MEDIA).pull(OPTIONS);

	expect(report.updated).toEqual(["Docs/Note.md"]);
	expect(files["Docs/Note.md"]).toBe(
		'---\nconnie-page-id: "1"\n---\n```mermaid\ngraph TD\n```\n\nIntro.\n\nOutro, edited.\n',
	);
	expect(bases.get("1")?.version).toBe(4);
});

test("pull skips pages whose version matches the base", async () => {
	const { vault } = fakeVault({ "A.md": '---\nconnie-page-id: "1"\n---\nText.\n' });
	const { store } = fakeState([base("1", "Text.\n", 2)]);
	const remote = fakeRemote([page("1", "Text.\n", 2)]);
	const report = await new PullService(remote, vault, store, NO_MEDIA).pull(OPTIONS);
	expect(report.unchanged).toBe(1);
	expect(report.updated).toEqual([]);
});

test("pull writes conflict markers when both sides changed the same block", async () => {
	const { vault, files } = fakeVault({ "A.md": '---\nconnie-page-id: "1"\n---\nLocal.\n' });
	const { store, bases } = fakeState([base("1", "Original.\n", 1)]);
	const remote = fakeRemote([page("1", "Remote.\n", 2)]);
	const report = await new PullService(remote, vault, store, NO_MEDIA).pull(OPTIONS);
	expect(report.conflicted).toEqual(["A.md"]);
	expect(files["A.md"]).toContain("<<<<<<< Obsidian\nLocal.\n=======\nRemote.\n>>>>>>> Confluence");
	expect(bases.get("1")?.version).toBe(2);
});

test("pull refuses notes that still have conflict markers", async () => {
	const text =
		'---\nconnie-page-id: "1"\n---\n<<<<<<< Obsidian\na\n=======\nb\n>>>>>>> Confluence\n';
	const { vault, files } = fakeVault({ "A.md": text });
	const { store } = fakeState([base("1", "x\n", 1)]);
	const report = await new PullService(
		fakeRemote([page("1", "y\n", 2)]),
		vault,
		store,
		NO_MEDIA,
	).pull({
		...OPTIONS,
	});
	expect(report.skipped[0]?.reason).toMatch(/conflict markers/);
	expect(files["A.md"]).toBe(text);
});

test("pull with no base records our own last publish without changing the note", async () => {
	const note = '---\nconnie-page-id: "1"\n---\nEdited locally since publish.\n';
	const { vault, files } = fakeVault({ "A.md": note });
	const { store, bases } = fakeState();
	const remote = fakeRemote([page("1", "Published text.\n", 5, { authorId: ME })]);
	const report = await new PullService(remote, vault, store, NO_MEDIA).pull(OPTIONS);
	expect(files["A.md"]).toBe(note);
	expect(report.unchanged).toBe(1);
	expect(bases.get("1")?.version).toBe(5);
});

test("pull with no base marks every difference when another user edited the page", async () => {
	const { vault, files } = fakeVault({ "A.md": '---\nconnie-page-id: "1"\n---\nMine.\n' });
	const { store } = fakeState();
	const report = await new PullService(
		fakeRemote([page("1", "Theirs.\n", 2)]),
		vault,
		store,
		NO_MEDIA,
	).pull({
		...OPTIONS,
	});
	expect(report.conflicted).toEqual(["A.md"]);
	expect(files["A.md"]).toContain("<<<<<<< Obsidian\nMine.\n=======\nTheirs.\n");
});

test("pull records a Confluence title change in connie-title", async () => {
	const { vault, frontmatter } = fakeVault({ "A.md": '---\nconnie-page-id: "1"\n---\nText.\n' });
	const { store } = fakeState([base("1", "Text.\n", 1)]);
	const remote = fakeRemote([page("1", "Text.\n", 2, { title: "Renamed" })]);
	const report = await new PullService(remote, vault, store, NO_MEDIA).pull(OPTIONS);
	expect(report.renamed).toEqual([{ path: "A.md", title: "Renamed" }]);
	expect(frontmatter.get("A.md")).toEqual({ "connie-title": "Renamed" });
});

test("pull reports notes whose page was deleted", async () => {
	const { vault } = fakeVault({ "A.md": '---\nconnie-page-id: "9"\n---\nText.\n' });
	const report = await new PullService(fakeRemote([]), vault, fakeState().store, NO_MEDIA).pull({
		...OPTIONS,
	});
	expect(report.deleted).toEqual(["A.md"]);
});

test("import creates notes and folders for new pages, and skips generated folder pages", async () => {
	const { vault, files, frontmatter } = fakeVault({
		"Docs/Existing.md": '---\nconnie-page-id: "10"\n---\nText.\n',
	});
	const { store } = fakeState([base("10", "Text.\n", 1)]);
	const remote = fakeRemote(
		[
			page("10", "Text.\n", 1),
			page("11", "New leaf.\n", 1, { title: "New: page" }),
			{ ...page("12", "", 1, { title: "Team" }), adf: folderPageAdf },
			page("13", "Nested.\n", 1, { title: "Nested" }),
			page("14", "Section body.\n", 1, { title: "Section" }),
			page("15", "Child.\n", 1, { title: "Child" }),
		],
		{
			root: [
				{ id: "10", title: "Page 10" },
				{ id: "11", title: "New: page" },
				{ id: "12", title: "Team" },
				{ id: "14", title: "Section" },
			],
			"12": [{ id: "13", title: "Nested" }],
			"14": [{ id: "15", title: "Child" }],
		},
	);
	const report = await new PullService(remote, vault, store, NO_MEDIA).pull({
		...OPTIONS,
		importUnder: { rootPageId: "root", rootFolder: "Fallback" },
	});

	expect(report.imported.sort()).toEqual([
		"Docs/New- page.md",
		"Docs/Section/Child.md",
		"Docs/Section/Section.md",
		"Docs/Team/Nested.md",
	]);
	expect(files["Docs/New- page.md"]).toBe("New leaf.\n");
	expect(frontmatter.get("Docs/New- page.md")).toEqual({
		"connie-page-id": "11",
		"connie-title": "New: page",
	});
	expect(files["Docs/Team.md"]).toBeUndefined();
});

test("import skips children of a regular note and never overwrites an existing note", async () => {
	const { vault, files } = fakeVault({
		"Docs/Leaf.md": '---\nconnie-page-id: "20"\n---\nLeaf.\n',
		"Docs/Taken.md": "Unlinked local note.\n",
	});
	const remote = fakeRemote(
		[
			page("20", "Leaf.\n", 1),
			page("21", "Child.\n", 1, { title: "Child" }),
			page("22", "x\n", 1, { title: "Taken" }),
		],
		{
			root: [
				{ id: "20", title: "Leaf" },
				{ id: "22", title: "Taken" },
			],
			"20": [{ id: "21", title: "Child" }],
		},
	);
	const report = await new PullService(
		remote,
		vault,
		fakeState([base("20", "Leaf.\n", 1)]).store,
		NO_MEDIA,
	).pull({
		...OPTIONS,
		importUnder: { rootPageId: "root", rootFolder: "Docs" },
	});
	expect(report.imported).toEqual([]);
	expect(report.skipped.map((entry) => entry.name).sort()).toEqual(["Child", "Taken"]);
	expect(files["Docs/Taken.md"]).toBe("Unlinked local note.\n");
});

test("note names from page titles cannot escape the folder", () => {
	expect(toNoteName("../../.config/plugins/x", "1")).toBe("-..-.config-plugins-x");
	expect(toNoteName("a/b\\c:d", "1")).toBe("a-b-c-d");
	expect(toNoteName("...", "7")).toBe("Untitled 7");
	expect(toNoteName("CON", "1")).toBe("CON page");
	expect(toNoteName("  Plan  ", "1")).toBe("Plan");
});

test("recognizes folder notes and generated folder pages", () => {
	expect(isFolderNote("Docs/Team/Team.md")).toBe(true);
	expect(isFolderNote("Docs/Team/index.md")).toBe(true);
	expect(isFolderNote("Docs/Team/Other.md")).toBe(false);
	expect(isFolderNote("Root.md")).toBe(false);
	expect(isGeneratedFolderPage(folderPageAdf)).toBe(true);
	expect(isGeneratedFolderPage(adf("Text.\n"))).toBe(false);
});

test("publish check blocks unpulled changes and conflict markers, and marks up-to-date pages", async () => {
	const { store } = fakeState([base("1", "a\n", 2), base("2", "b\n", 3)]);
	const remote = fakeRemote([page("1", "a\n", 2), page("2", "b changed\n", 4)]);
	const check = await checkBeforePublish(
		[
			{ path: "One.md", pageId: "1", text: "a\n" },
			{ path: "Two.md", pageId: "2", text: "b\n" },
			{
				path: "Three.md",
				pageId: undefined,
				text: "<<<<<<< Obsidian\nx\n=======\ny\n>>>>>>> Confluence\n",
			},
			{ path: "New.md", pageId: undefined, text: "new\n" },
		],
		remote,
		store,
	);
	expect(check.blocked).toEqual([
		{ fileName: "Three.md", reason: HAS_CONFLICTS },
		{ fileName: "Two.md", reason: NEEDS_PULL },
	]);
	expect([...check.upToDate]).toEqual(["One.md"]);
});

test("pull reformats notes whose snapshot came from an older converter, without a page change", async () => {
	const oldFence = '```adf\n{"type":"panel","attrs":{"panelType":"warning"}}\n```\n';
	const note = `---\nconnie-page-id: "1"\n---\nIntro.\n\n${oldFence}`;
	const { vault, files } = fakeVault({ "A.md": note });
	const { store, bases } = fakeState([
		{
			pageId: "1",
			version: 3,
			title: "Page 1",
			markdown: `Intro.\n\n${oldFence}`,
			format: 1,
			unresolvedLinks: [],
			unresolvedMedia: [],
		},
	]);
	const remote = fakeRemote([page("1", "Intro.\n\n> [!warning] Careful.\n", 3)]);
	const report = await new PullService(remote, vault, store, NO_MEDIA).pull(OPTIONS);
	expect(report.updated).toEqual(["A.md"]);
	expect(files["A.md"]).toBe('---\nconnie-page-id: "1"\n---\nIntro.\n\n> [!warning]\n> Careful.\n');
	expect(bases.get("1")?.format).toBe(MERGE_FORMAT);
});

test("imported pages link to each other and to existing notes as wikilinks", async () => {
	const pageUrl = (id: string) => `${BASE_URL}/wiki/spaces/IT/pages/${id}/Title`;
	const { vault, files } = fakeVault({
		"Docs/Existing.md": '---\nconnie-page-id: "10"\n---\nText.\n',
	});
	const remote = fakeRemote(
		[
			page("10", "Text.\n", 1),
			page("11", `See [Second](${pageUrl("12")}) and [Existing](${pageUrl("10")}).\n`, 1, {
				title: "First",
			}),
			page("12", `Back to [First](${pageUrl("11")}).\n`, 1, { title: "Second" }),
		],
		{
			root: [
				{ id: "10", title: "Existing" },
				{ id: "11", title: "First" },
				{ id: "12", title: "Second" },
			],
		},
	);
	await new PullService(remote, vault, fakeState([base("10", "Text.\n", 1)]).store, NO_MEDIA).pull({
		...OPTIONS,
		importUnder: { rootPageId: "root", rootFolder: "Docs" },
	});
	expect(files["Docs/First.md"]).toBe("See [[Second]] and [[Existing]].\n");
	expect(files["Docs/Second.md"]).toBe("Back to [[First]].\n");
});

test("a note is converted again once a page it links to gets a note", async () => {
	const link = `[Later](${BASE_URL}/wiki/spaces/IT/pages/20/Later)`;
	const note = `---\nconnie-page-id: "1"\n---\nSee ${link}.\n`;
	const { vault, files } = fakeVault({ "A.md": note });
	const { store, bases } = fakeState([
		{ ...base("1", `See ${link}.\n`, 2), unresolvedLinks: ["20"] },
	]);
	const remote = fakeRemote([page("1", `See ${link}.\n`, 2)]);
	const service = new PullService(remote, vault, store, NO_MEDIA);

	await service.pull(OPTIONS);
	expect(files["A.md"]).toBe(note);

	files["Later.md"] = '---\nconnie-page-id: "20"\n---\nLater.\n';
	const report = await service.pull(OPTIONS);
	expect(report.updated).toEqual(["A.md"]);
	expect(files["A.md"]).toBe('---\nconnie-page-id: "1"\n---\nSee [[Later]].\n');
	expect(bases.get("1")?.unresolvedLinks).toEqual([]);
});

test("imports images as embeds of downloaded files in the image folder", async () => {
	const imageBlock = {
		type: "mediaSingle",
		attrs: { widthType: "pixel" },
		content: [
			{
				type: "media",
				attrs: {
					alt: "shot.png",
					collection: "contentId-30",
					height: 810,
					id: "file-1",
					type: "file",
				},
			},
		],
	};
	const pageAdf = {
		type: "doc",
		version: 1,
		content: [
			{ type: "paragraph", content: [{ type: "text", text: "Images test." }] },
			imageBlock,
			{ type: "paragraph" },
		],
	};
	const { vault, files } = fakeVault({});
	const binaries: Record<string, Uint8Array> = {};
	const mediaVault = {
		filePaths: () => [...Object.keys(files), ...Object.keys(binaries)],
		exists: (path: string) => path in files || path in binaries,
		writeBinary: async (path: string, data: Uint8Array) => void (binaries[path] = data),
	};
	const remote = fakeRemote([{ ...page("30", "", 1, { title: "With image" }), adf: pageAdf }], {
		root: [{ id: "30", title: "With image" }],
	});
	const downloads: string[] = [];
	const mediaRemote = {
		listAttachments: async () => [
			{ id: "att1", title: "08-52-33 09-16-2026.png", fileId: "file-1" },
		],
		downloadAttachment: async (pageId: string, attachmentId: string) => {
			downloads.push(`${pageId}/${attachmentId}`);
			return new Uint8Array([1, 2, 3]);
		},
	};
	const { store, media } = fakeState();
	const sync = new MediaSync(mediaRemote, mediaVault, store, "images");
	const report = await new PullService(remote, vault, store, sync).pull({
		...OPTIONS,
		importUnder: { rootPageId: "root", rootFolder: "Docs" },
	});

	expect(report.imported).toEqual(["Docs/With image.md"]);
	expect(files["Docs/With image.md"]).toBe("Images test.\n\n![[08-52-33 09-16-2026.png]]\n");
	expect(binaries["images/08-52-33 09-16-2026.png"]).toEqual(new Uint8Array([1, 2, 3]));
	expect(media).toEqual({ "file-1": "images/08-52-33 09-16-2026.png" });
	expect(downloads).toEqual(["30/att1"]);
});

test("reuses downloaded and published images instead of downloading again", async () => {
	const files: Record<string, string> = {
		"images/diagram.png": "",
		"Docs/local.png": "",
	};
	const vault = {
		filePaths: () => Object.keys(files),
		exists: (path: string) => path in files,
		writeBinary: async () => {
			throw new Error("should not download");
		},
	};
	const mediaRemote = {
		listAttachments: async () => [
			{ id: "a2", title: "0123456789abcdef0123456789abcdef-local.png", fileId: "published" },
		],
		downloadAttachment: async () => {
			throw new Error("should not download");
		},
	};
	const { store } = fakeState();
	await store.setMedia({ known: "images/diagram.png" });
	const sync = new MediaSync(mediaRemote, vault, store, "images");
	const adfWith = (...ids: string[]) => ({
		type: "doc",
		content: ids.map((id) => ({
			type: "mediaSingle",
			content: [{ type: "media", attrs: { id, type: "file", collection: "contentId-5" } }],
		})),
	});
	expect(await sync.ensure(adfWith("known", "published"), { download: false })).toEqual([]);
	const resolve = sync.resolver();
	expect(resolve("known")).toBe("diagram.png");
	expect(resolve("published")).toBe("local.png");
});

test("names downloaded files safely and without overwriting", () => {
	expect(safeFileName("../../evil.png", "1")).toEqual({ name: "-..-evil", extension: ".png" });
	expect(safeFileName("report.final.PDF", "1")).toEqual({
		name: "report.final",
		extension: ".pdf",
	});
	expect(safeFileName("no extension", "1")).toEqual({ name: "no extension", extension: "" });
	expect(safeFileName("weird.ex$e", "1")).toEqual({ name: "weird.ex$e", extension: "" });
});

test("records published pages as pull bases, skipping unchanged pages already recorded", async () => {
	const { vault } = fakeVault({ "A.md": '---\nconnie-page-id: "1"\n---\nText.\n' });
	const { store, bases } = fakeState([base("2", "Old.\n", 1)]);
	const pages = fakeRemote([page("1", "Text.\n", 4), page("2", "Changed.\n", 2)]);
	const remote: ConfluenceRemote = {
		...pages,
		getPage: async (id) => {
			if (id === "3") throw new Error("Forbidden");
			return pages.getPage(id);
		},
	};
	const failures = await new PullService(remote, vault, store, NO_MEDIA).recordPublished(
		[
			{ pageId: "1", unchanged: false, fingerprint: "one" },
			{ pageId: "2", unchanged: true, fingerprint: "two" },
			{ pageId: "3", unchanged: false, fingerprint: "three" },
		],
		OPTIONS,
	);
	expect(bases.get("1")).toMatchObject({
		version: 4,
		markdown: "Text.\n",
		format: MERGE_FORMAT,
		localFingerprint: "one",
	});
	expect(bases.get("2")).toMatchObject({ version: 1, localFingerprint: "two" });
	expect(failures).toEqual([{ pageId: "3", reason: "Forbidden" }]);
});

test("a note that was in sync stays in sync after a clean pull", async () => {
	const note = '---\nconnie-page-id: "1"\n---\nIntro.\n\nOutro.\n';
	const { vault, files } = fakeVault({ "A.md": note });
	const { store, bases } = fakeState([
		{ ...base("1", "Intro.\n\nOutro.\n", 3), localFingerprint: fingerprintOf(note) },
	]);
	const remote = fakeRemote([page("1", "Intro.\n\nOutro, edited.\n", 4)]);
	await new PullService(remote, vault, store, NO_MEDIA).pull(OPTIONS);
	expect(files["A.md"]).toContain("Outro, edited.");
	expect(bases.get("1")?.localFingerprint).toBe(fingerprintOf(files["A.md"]!));
});

test("a note with local changes stays marked as changed after a pull", async () => {
	const published = '---\nconnie-page-id: "1"\n---\nIntro.\n\nOutro.\n';
	const { vault, files } = fakeVault({
		"A.md": '---\nconnie-page-id: "1"\n---\nIntro, local.\n\nOutro.\n',
	});
	const { store, bases } = fakeState([
		{ ...base("1", "Intro.\n\nOutro.\n", 3), localFingerprint: fingerprintOf(published) },
	]);
	const remote = fakeRemote([page("1", "Intro.\n\nOutro, edited.\n", 4)]);
	await new PullService(remote, vault, store, NO_MEDIA).pull(OPTIONS);
	expect(files["A.md"]).toContain("Intro, local.");
	expect(bases.get("1")?.localFingerprint).toBe(fingerprintOf(published));
});

test("imported notes start in sync", async () => {
	const { vault, files } = fakeVault({});
	const { store, bases } = fakeState();
	const remote = fakeRemote([page("30", "Imported.\n", 1, { title: "New page" })], {
		root: [{ id: "30", title: "New page" }],
	});
	await new PullService(remote, vault, store, NO_MEDIA).pull({
		...OPTIONS,
		importUnder: { rootPageId: "root", rootFolder: "Docs" },
	});
	expect(bases.get("30")?.localFingerprint).toBe(fingerprintOf(files["Docs/New page.md"]!));
});

test("publishing changes skips notes whose fingerprint matches the last sync", async () => {
	const { store } = fakeState([
		{ ...base("1", "A.\n", 1), localFingerprint: "same" },
		{ ...base("2", "B.\n", 1), localFingerprint: "old" },
		base("3", "C.\n", 1),
	]);
	const notes = [
		{ path: "A.md", pageId: "1", text: "" },
		{ path: "B.md", pageId: "2", text: "" },
		{ path: "C.md", pageId: "3", text: "" },
		{ path: "New.md", pageId: undefined, text: "" },
	];
	const changed = await findChangedNotes(notes, store, async (path) =>
		path === "A.md" ? "same" : "new",
	);
	expect(changed.map((note) => note.path)).toEqual(["B.md", "C.md", "New.md"]);
});
