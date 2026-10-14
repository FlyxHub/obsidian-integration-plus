/** Device names Windows reserves, with or without an extension (`con`, `con.txt`). */
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(?=\.|$)/i;

/**
 * Turn a Confluence page title into a safe note name. Titles come from the server, so path
 * separators, characters Obsidian or the OS reject, and leading and trailing dots are all
 * removed.
 */
export function toNoteName(title: string, pageId: string): string {
	const name = title
		.replace(/[\p{Cc}\\/:*?"<>|#^[\]]/gu, "-")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 180)
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.replace(RESERVED_WINDOWS_NAMES, "$1 page");
	return name || `Untitled ${pageId}`;
}
