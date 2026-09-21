import { expect, test } from "@effect/vitest";
import { parseMarkdownToADF } from "@markdown-confluence/lib";
import { adfToMergeMarkdown } from "./adfMarkdown";
import type { ConfluenceRemote, RemoteChild, RemotePage } from "./confluenceRemote";
import { HAS_CONFLICTS, NEEDS_PULL, checkBeforePublish } from "./publishGate";
import {
	PullService,
	isFolderNote,
	isGeneratedFolderPage,
	toNoteName,
	type PullVault,
} from "./pull";
import type { SyncBase, SyncStateStore } from "./syncState";

const BASE_URL = "https://example.atlassian.net";
const ME = "me";
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
					return page ? [[id, { version: page.version, authorId: page.authorId }] as const] : [];
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
		parentId: undefined,
		...extra,
	};
}

function fakeState(initial: SyncBase[] = []) {
	const bases = new Map(initial.map((base) => [base.pageId, base]));
	const store: SyncStateStore = {
		get: async (id) => bases.get(id),
		set: async (base) => void bases.set(base.pageId, base),
	};
	return { store, bases };
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
		exists: (path) => path in files,
		create: async (path, body, values) => {
			files[path] = body;
			frontmatter.set(path, values);
		},
	};
	return { vault, files, frontmatter };
}

const base = (id: string, markdown: string, version: number): SyncBase => ({
	pageId: id,
	version,
	title: `Page ${id}`,
	markdown: adfToMergeMarkdown(adf(markdown), BASE_URL),
});

test("pull merges a Confluence edit into the note and keeps frontmatter and local-only syntax", async () => {
	const published = "Intro.\n\nOutro.\n";
	const note = '---\nconnie-page-id: "1"\n---\n```mermaid\ngraph TD\n```\n\nIntro.\n\nOutro.\n';
	const { vault, files } = fakeVault({ "Docs/Note.md": note });
	const { store, bases } = fakeState([base("1", published, 3)]);
	const remote = fakeRemote([page("1", "Intro.\n\nOutro, edited.\n", 4)]);

	const report = await new PullService(remote, vault, store).pull({ confluenceBaseUrl: BASE_URL });

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
	const report = await new PullService(remote, vault, store).pull({ confluenceBaseUrl: BASE_URL });
	expect(report.unchanged).toBe(1);
	expect(report.updated).toEqual([]);
});

test("pull writes conflict markers when both sides changed the same block", async () => {
	const { vault, files } = fakeVault({ "A.md": '---\nconnie-page-id: "1"\n---\nLocal.\n' });
	const { store, bases } = fakeState([base("1", "Original.\n", 1)]);
	const remote = fakeRemote([page("1", "Remote.\n", 2)]);
	const report = await new PullService(remote, vault, store).pull({ confluenceBaseUrl: BASE_URL });
	expect(report.conflicted).toEqual(["A.md"]);
	expect(files["A.md"]).toContain("<<<<<<< Obsidian\nLocal.\n=======\nRemote.\n>>>>>>> Confluence");
	expect(bases.get("1")?.version).toBe(2);
});

test("pull refuses notes that still have conflict markers", async () => {
	const text =
		'---\nconnie-page-id: "1"\n---\n<<<<<<< Obsidian\na\n=======\nb\n>>>>>>> Confluence\n';
	const { vault, files } = fakeVault({ "A.md": text });
	const { store } = fakeState([base("1", "x\n", 1)]);
	const report = await new PullService(fakeRemote([page("1", "y\n", 2)]), vault, store).pull({
		confluenceBaseUrl: BASE_URL,
	});
	expect(report.skipped[0]?.reason).toMatch(/conflict markers/);
	expect(files["A.md"]).toBe(text);
});

test("pull with no base records our own last publish without changing the note", async () => {
	const note = '---\nconnie-page-id: "1"\n---\nEdited locally since publish.\n';
	const { vault, files } = fakeVault({ "A.md": note });
	const { store, bases } = fakeState();
	const remote = fakeRemote([page("1", "Published text.\n", 5, { authorId: ME })]);
	const report = await new PullService(remote, vault, store).pull({ confluenceBaseUrl: BASE_URL });
	expect(files["A.md"]).toBe(note);
	expect(report.unchanged).toBe(1);
	expect(bases.get("1")?.version).toBe(5);
});

test("pull with no base marks every difference when another user edited the page", async () => {
	const { vault, files } = fakeVault({ "A.md": '---\nconnie-page-id: "1"\n---\nMine.\n' });
	const { store } = fakeState();
	const report = await new PullService(fakeRemote([page("1", "Theirs.\n", 2)]), vault, store).pull({
		confluenceBaseUrl: BASE_URL,
	});
	expect(report.conflicted).toEqual(["A.md"]);
	expect(files["A.md"]).toContain("<<<<<<< Obsidian\nMine.\n=======\nTheirs.\n");
});

test("pull records a Confluence title change in connie-title", async () => {
	const { vault, frontmatter } = fakeVault({ "A.md": '---\nconnie-page-id: "1"\n---\nText.\n' });
	const { store } = fakeState([base("1", "Text.\n", 1)]);
	const remote = fakeRemote([page("1", "Text.\n", 2, { title: "Renamed" })]);
	const report = await new PullService(remote, vault, store).pull({ confluenceBaseUrl: BASE_URL });
	expect(report.renamed).toEqual([{ path: "A.md", title: "Renamed" }]);
	expect(frontmatter.get("A.md")).toEqual({ "connie-title": "Renamed" });
});

test("pull reports notes whose page was deleted", async () => {
	const { vault } = fakeVault({ "A.md": '---\nconnie-page-id: "9"\n---\nText.\n' });
	const report = await new PullService(fakeRemote([]), vault, fakeState().store).pull({
		confluenceBaseUrl: BASE_URL,
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
	const report = await new PullService(remote, vault, store).pull({
		confluenceBaseUrl: BASE_URL,
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
	).pull({
		confluenceBaseUrl: BASE_URL,
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
