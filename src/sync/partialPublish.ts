import { MarkdownWorkspaceService } from "@markdown-confluence/lib";
import { Effect, Layer } from "effect";
import { baseName, parentOf, toVaultPath } from "../paths";

/**
 * Choosing the notes to hand the publisher when only some notes changed.
 *
 * The lib publishes either one note or every note, and builds the page tree from the notes
 * it's given. Giving it only the changed notes would change that tree:
 *
 * - The tree's root folder is the longest folder path that all notes share, so a subset in
 *   one subfolder would move its pages directly under the parent page.
 * - A folder whose folder note is missing gets a generated page-tree page, which would
 *   overwrite the page that the folder note published.
 *
 * So the subset also includes the folder note of every folder on the way to a changed note,
 * and, when needed, another note that keeps the root folder the same. These rules copy
 * `TreeLocal.ts` in `@markdown-confluence/lib` 7.0.0; check them when upgrading the lib.
 */

const FOLDER_NOTE_NAMES = ["index", "README", "readme"];

/**
 * The notes to publish: the changed notes and the notes the page tree needs around them.
 * Returns undefined when the subset can't keep the same tree, so the caller publishes all.
 */
export function notesForPartialPublish(
	allPaths: readonly string[],
	changed: readonly string[],
): string[] | undefined {
	const all = new Set(allPaths);
	const selected = new Set(changed.filter((path) => all.has(path)));
	if (selected.size === 0) return [];
	const root = treeRoot([...all]);

	const addFolderNotes = (path: string) => {
		for (let folder = parentOf(path); ; folder = parentOf(folder)) {
			if (!isWithin(folder, root)) break;
			const folderNote = folderNoteOf(folder, all);
			if (folderNote) selected.add(folderNote);
			if (folder === root) break;
		}
	};
	for (const path of [...selected]) addFolderNotes(path);

	if (treeRoot([...selected]) !== root) {
		// Add a note from another branch under the root, so the shared folder is the root again.
		const branch = firstSegmentUnder(root, [...selected][0]!);
		const other =
			[...all].find((path) => parentOf(path) === root) ??
			[...all].find((path) => firstSegmentUnder(root, path) !== branch);
		if (other) {
			selected.add(other);
			addFolderNotes(other);
		}
	}
	return treeRoot([...selected]) === root ? [...selected] : undefined;
}

/** The lib's `findTreeRootPath`: the folders all paths share, or the parent of a lone file. */
export function treeRoot(paths: readonly string[]): string {
	const [first, ...rest] = paths;
	if (first === undefined) return "";
	const shared = first.split("/");
	for (const path of rest) {
		const parts = path.split("/");
		const differs = shared.findIndex((part, index) => parts[index] !== part);
		if (differs !== -1) shared.splice(differs);
	}
	const root = shared.join("/");
	return paths.includes(root) ? parentOf(root) : root;
}

/** The note that supplies a folder's page: named like the folder, or index/README. */
function folderNoteOf(folder: string, all: ReadonlySet<string>): string | undefined {
	const prefix = folder ? `${folder}/` : "";
	const names = [baseName(folder), ...FOLDER_NOTE_NAMES].filter(Boolean);
	return names.map((name) => `${prefix}${name}.md`).find((path) => all.has(path));
}

function isWithin(folder: string, root: string): boolean {
	return root === "" || folder === root || folder.startsWith(`${root}/`);
}

function firstSegmentUnder(root: string, path: string): string {
	const relative = root ? path.slice(root.length + 1) : path;
	return relative.split("/")[0] ?? "";
}

/** The lib's Markdown workspace, narrowed to the notes from `notesForPartialPublish`. */
export function partialWorkspace(notes: ReadonlySet<string>) {
	return Layer.effect(MarkdownWorkspaceService)(
		Effect.gen(function* () {
			const workspace = yield* MarkdownWorkspaceService;
			return {
				...workspace,
				getMarkdownFilesToUpload: Effect.map(workspace.getMarkdownFilesToUpload, (files) =>
					files.filter((file) => notes.has(toVaultPath(file.absoluteFilePath))),
				),
			};
		}),
	);
}
