import { parseUrl } from "../paths";

/** Accept a page ID or the full browser URL of a Confluence page. */
export function confluencePageId(value: string): string | undefined {
	const input = value.trim();
	// Keep IDs as strings: large Confluence IDs can exceed safe integer precision.
	if (/^\d+$/.test(input)) return input;
	const url = parseUrl(input);
	if (!url || !["https:", "http:"].includes(url.protocol)) return undefined;
	return url.pathname.match(/\/pages\/(\d+)(?:\/|$)/)?.[1];
}
