import * as EffectPath from "effect/Path";
import * as EffectFileSystem from "effect/FileSystem";
import { Effect, Layer, Option } from "effect";
import { systemError, type PlatformError } from "effect/PlatformError";
import { App, normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";
import { RuntimeEnvironmentService } from "@markdown-confluence/lib";

export function ObsidianPlatformLive(app: App) {
	return Layer.mergeAll(
		ObsidianFileSystemLive(app),
		ObsidianPathLive,
		Layer.succeed(RuntimeEnvironmentService as never, {
			cwd: Effect.succeed("/"),
			chdir: () => Effect.void,
			argv: Effect.succeed([]),
			getEnv: (_name: string) => Effect.succeed(undefined),
			setMaxListeners: () => Effect.void,
			exit: (code: number) => Effect.die(new Error(`Unexpected Obsidian exit ${code}`)),
		}),
	);
}

const ObsidianPathLive: Layer.Layer<EffectPath.Path> = Layer.effect(EffectPath.Path)(
	Effect.map(Effect.provide(EffectPath.Path, EffectPath.layer), (path): EffectPath.Path => ({
		...path,
		resolve: (...pathSegments) => {
			const pathText = pathSegments.filter((segment) => segment.length > 0).join("/");
			const rootedPath = pathText.startsWith("/") ? pathText : `/${pathText}`;
			return path.normalize(rootedPath);
		},
	})),
);

function ObsidianFileSystemLive(app: App): Layer.Layer<EffectFileSystem.FileSystem> {
	return EffectFileSystem.layerNoop({
		access: (path) => Effect.asVoid(find(app, path, "access", TAbstractFile)),
		exists: (path) => Effect.sync(() => getAbstractFile(app, path) !== null),
		readDirectory: (path) =>
			Effect.map(find(app, path, "readDirectory", TFolder), (folder) =>
				folder.children.map((child) => child.name),
			),
		readFile: (path) =>
			Effect.flatMap(find(app, path, "readFile", TFile), (file) =>
				Effect.tryPromise({
					try: async () => new Uint8Array(await app.vault.readBinary(file)),
					catch: (cause) => toPlatformError("readFile", path, cause),
				}),
			),
		readFileString: (path) =>
			Effect.flatMap(find(app, path, "readFileString", TFile), (file) =>
				Effect.tryPromise({
					try: () => app.vault.cachedRead(file),
					catch: (cause) => toPlatformError("readFileString", path, cause),
				}),
			),
		stat: (path) =>
			Effect.map(find(app, path, "stat", TAbstractFile), (file) => {
				const now = new Date();
				const stats = file instanceof TFile ? file.stat : undefined;
				const mtime = stats ? new Date(stats.mtime) : now;
				const ctime = stats ? new Date(stats.ctime) : now;

				return {
					type: file instanceof TFolder ? "Directory" : "File",
					mtime: Option.some(mtime),
					atime: Option.none(),
					birthtime: Option.some(ctime),
					dev: 0,
					ino: Option.none(),
					mode: file instanceof TFolder ? 0o755 : 0o644,
					nlink: Option.none(),
					uid: Option.none(),
					gid: Option.none(),
					rdev: Option.none(),
					size: EffectFileSystem.Size(stats?.size ?? 0),
					blksize: Option.none(),
					blocks: Option.none(),
				};
			}),
		writeFileString: (path, data) =>
			Effect.tryPromise({
				try: async () => {
					const file = getAbstractFile(app, path);
					if (file instanceof TFile) {
						// process() serializes this write with other vault operations on the file.
						await app.vault.process(file, () => data);
						return;
					}

					await app.vault.create(toVaultPath(path), data);
				},
				catch: (cause) => toPlatformError("writeFileString", path, cause),
			}),
	});
}

function getAbstractFile(app: App, path: string) {
	const vaultPath = toVaultPath(path);
	return vaultPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(vaultPath);
}

/** The file or folder of the given type at `path`, or a NotFound error from `method`. */
function find<T extends TAbstractFile>(
	app: App,
	path: string,
	method: string,
	type: abstract new (...args: never[]) => T,
): Effect.Effect<T, PlatformError> {
	const file = getAbstractFile(app, path);
	return file instanceof type ? Effect.succeed(file) : Effect.fail(toNotFound(method, path));
}

function toVaultPath(path: string): string {
	const vaultPath = normalizePath(path.replace(/^\/+/, ""));
	return vaultPath === "." ? "" : vaultPath;
}

function toNotFound(method: string, path: string): PlatformError {
	return systemError({
		_tag: "NotFound",
		module: "ObsidianFileSystem",
		method,
		description: "No such file or directory",
		pathOrDescriptor: path,
	});
}

function toPlatformError(method: string, path: string, cause: unknown): PlatformError {
	return systemError({
		_tag: "Unknown",
		module: "ObsidianFileSystem",
		method,
		pathOrDescriptor: path,
		cause,
	});
}
