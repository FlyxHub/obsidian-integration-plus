import { isRedirect, nodeRequest } from "./nodeRequest";

/** Largest diagram image a diagram server may return. */
const MAX_DIAGRAM_BYTES = 50 * 1024 * 1024;
const MAX_PLANTUML_REDIRECTS = 3;
/** Statuses whose responses can't have a body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * Desktop diagram transport: avoids browser CORS and preserves binary image bytes. Plain HTTP
 * is allowed for self-hosted Kroki servers, which never receive credentials.
 */
export async function krokiFetch(
	url: string,
	init: RequestInit,
): Promise<Pick<Response, "ok" | "status" | "headers" | "arrayBuffer">> {
	if (init.body != null && typeof init.body !== "string")
		throw new Error("Kroki requests need a text body");
	const response = await nodeRequest(url, {
		method: init.method ?? "GET",
		headers: Object.fromEntries(new Headers(init.headers)),
		body: init.body ?? undefined,
		signal: init.signal,
		allowHttp: true,
		maxBytes: MAX_DIAGRAM_BYTES,
	});
	if (isRedirect(response.status)) throw new Error("Kroki redirects are not permitted");
	return {
		ok: response.status >= 200 && response.status < 300,
		status: response.status,
		headers: response.headers,
		arrayBuffer: async () => Uint8Array.from(response.body).buffer,
	};
}

/**
 * The same transport for PlantUML servers. Its requests carry only the encoded diagram, so
 * redirects are followed, as the browser fetch it replaces did.
 */
export async function plantumlFetch(
	input: RequestInfo | URL,
	init: RequestInit = {},
): Promise<Response> {
	let url = input instanceof Request ? input.url : String(input);
	for (let hop = 0; hop <= MAX_PLANTUML_REDIRECTS; hop++) {
		const response = await nodeRequest(url, {
			headers: Object.fromEntries(new Headers(init.headers)),
			signal: init.signal,
			allowHttp: true,
			maxBytes: MAX_DIAGRAM_BYTES,
		});
		if (isRedirect(response.status) && response.location) {
			url = new URL(response.location, url).href;
			continue;
		}
		return new Response(
			NULL_BODY_STATUSES.has(response.status) ? null : new Uint8Array(response.body),
			{ status: response.status, statusText: response.statusText, headers: response.headers },
		);
	}
	throw new Error("The PlantUML server redirected too many times.");
}
