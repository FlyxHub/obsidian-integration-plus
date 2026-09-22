import type { ConfluenceFetch } from "@markdown-confluence/lib";
import { isRedirect, nodeRequest } from "./nodeRequest";

/** Desktop HTTPS transport: bypass browser CORS, preserve aborts, never follow redirects. */
export const desktopFetch: ConfluenceFetch = async (url, init) => {
	if (new URL(url).protocol !== "https:") throw new Error("Confluence requests require HTTPS");
	// Request serializes native FormData, including its boundary, without corrupting binary files.
	const serialized = new Request(url, init);
	const response = await nodeRequest(url, {
		method: serialized.method,
		headers: Object.fromEntries(serialized.headers),
		body: init.body == null ? undefined : Buffer.from(await serialized.arrayBuffer()),
		signal: init.signal,
	});
	if (isRedirect(response.status)) throw new Error("Confluence redirects are not permitted");
	const text = response.body.toString("utf8");
	return {
		ok: response.status >= 200 && response.status < 300,
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
		text: async () => text,
		json: async () => JSON.parse(text) as unknown,
	};
};
