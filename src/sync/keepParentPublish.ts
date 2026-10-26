import {
	MarkdownWorkspaceService,
	type MarkdownFile,
	type Publisher,
} from "@markdown-confluence/lib";
import { Effect } from "effect";
import { KEEP_PARENT_KEY, PAGE_ID_KEY } from "../frontmatterKeys";
import { baseName, joinPath, parentOf, toVaultPath } from "../paths";
import { isFolderNote, treeRoot } from "./partialPublish";

type PublishResults = Awaited<ReturnType<Publisher["publish"]>>;

/** Folder notes still supply a parent when ordinary notes below them need that hierarchy. */
export function independentNotes(
	files: readonly { path: string; frontmatter: Record<string, unknown> }[],
): Set<string> {
	const eligible = new Set(
		files
			.filter(({ frontmatter }) => {
				const id = frontmatter[PAGE_ID_KEY];
				return (
					frontmatter[KEEP_PARENT_KEY] === true &&
					((typeof id === "string" && /^\d+$/.test(id)) ||
						(typeof id === "number" && Number.isSafeInteger(id)))
				);
			})
			.map(({ path }) => path),
	);
	return new Set(
		[...eligible].filter(
			(path) =>
				!isFolderNote(path) ||
				!files.some(
					(file) => !eligible.has(file.path) && file.path.startsWith(`${parentOf(path)}/`),
				),
		),
	);
}

/**
 * Keep-parent pages need no local ancestor pages. Give them flat paths only while the
 * library builds its tree; frontmatter writes, media reads and results retain vault paths.
 * Markdown preprocessing happens before this adapter, so relative links and embeds keep
 * their original source context. The library remains responsible for every upload.
 */
export function publishKeepingParents(
	publisher: Publisher,
	filter?: string,
	options?: { signal?: AbortSignal },
) {
	return Effect.gen(function* () {
		const workspace = yield* MarkdownWorkspaceService;
		const available = yield* workspace.getMarkdownFilesToUpload;
		const current = filter
			? available.find((file) => toVaultPath(file.absoluteFilePath) === toVaultPath(filter))
			: undefined;
		// The library filters uploads only after resolving the entire tree. For a linked
		// keep-parent current note, unrelated siblings must not enter that tree at all.
		// Classify it alone: even a folder note needs no children for this command.
		const standalone =
			current &&
			independentNotes([
				{
					path: toVaultPath(current.absoluteFilePath),
					frontmatter: current.frontmatter,
				},
			]).size > 0;
		const files = standalone ? [current] : available;
		const independent = independentNotes(
			files.map((file) => ({
				path: toVaultPath(file.absoluteFilePath),
				frontmatter: file.frontmatter,
			})),
		);
		const root = treeRoot(files.map((file) => file.absoluteFilePath));
		const originals = new Map<string, MarkdownFile>();
		const aliases = new Map<string, string>();
		const occupied = new Set(files.map((file) => toVaultPath(file.absoluteFilePath).toLowerCase()));
		const planned = files.map((file) => {
			const path = toVaultPath(file.absoluteFilePath);
			if (!independent.has(path)) return file;
			let name = `__connie_page_${String(file.frontmatter[PAGE_ID_KEY])}`;
			// Never collide with a real file or accidentally become the root's folder note.
			while (
				occupied.has(toVaultPath(joinPath(root, `${name}.md`)).toLowerCase()) ||
				name === baseName(root)
			)
				name += "_";
			const alias = joinPath(root, `${name}.md`);
			occupied.add(toVaultPath(alias).toLowerCase());
			originals.set(toVaultPath(alias), file);
			aliases.set(path, alias);
			return { ...file, absoluteFilePath: alias, fileName: `${name}.md` };
		});
		const originalPath = (path: string) =>
			originals.get(toVaultPath(path))?.absoluteFilePath ?? path;
		const adapted = {
			...workspace,
			getMarkdownFilesToUpload: Effect.succeed(planned),
			updateMarkdownValues: (
				path: string,
				values: Parameters<typeof workspace.updateMarkdownValues>[1],
			) => workspace.updateMarkdownValues(originalPath(path), values),
			loadMarkdownFile: (path: string) => workspace.loadMarkdownFile(originalPath(path)),
			readBinary: (search: string, from: string) =>
				workspace.readBinary(search, originalPath(from)),
			readText: (search: string, from: string) => workspace.readText(search, originalPath(from)),
		};
		const results = yield* publisher
			.publishEffect(filter ? (aliases.get(toVaultPath(filter)) ?? filter) : undefined, options)
			.pipe(Effect.provideService(MarkdownWorkspaceService, adapted));
		const restore = <T extends { absoluteFilePath: string; fileName: string; folderName: string }>(
			file: T,
		): T => {
			const original = originals.get(toVaultPath(file.absoluteFilePath));
			return original
				? {
						...file,
						absoluteFilePath: original.absoluteFilePath,
						fileName: original.fileName,
						folderName: original.folderName,
					}
				: file;
		};
		return results.map((result) => ({
			...result,
			node: { ...result.node, file: restore(result.node.file) },
			...(result.successfulUploadResult
				? {
						successfulUploadResult: {
							...result.successfulUploadResult,
							adfFile: restore(result.successfulUploadResult.adfFile),
						},
					}
				: {}),
		})) satisfies PublishResults;
	});
}
