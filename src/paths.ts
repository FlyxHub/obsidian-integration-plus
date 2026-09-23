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

/** True for links with a URL scheme, such as `https:`, which aren't vault paths. */
export function hasUrlScheme(link: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(link);
}

/** Percent-decode a link, keeping it as it is when it isn't valid percent-encoding. */
export function decodeLink(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
