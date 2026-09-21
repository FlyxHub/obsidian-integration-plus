const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Turn a Confluence page title into a safe note name. Titles come from the server, so path
 * separators, characters Obsidian or the OS reject, and leading dots are all removed.
 */
export function toNoteName(title: string, pageId: string): string {
	let name = [...title]
		.map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? "-" : char))
		.join("")
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.slice(0, 180)
		.trim();
	if (RESERVED_WINDOWS_NAMES.test(name)) name = `${name} page`;
	return name || `Untitled ${pageId}`;
}
