/** The lib reports vault paths with platform separators and sometimes a leading slash. */
export function toVaultPath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

/** The folder part of a vault path; `""` for files at the vault root. */
export function parentOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

/** The file name part of a vault path, with its extension. */
export function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
