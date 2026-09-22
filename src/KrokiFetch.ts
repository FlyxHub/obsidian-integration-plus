import { isRedirect, nodeRequest } from "./nodeRequest";

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
	});
	if (isRedirect(response.status)) throw new Error("Kroki redirects are not permitted");
	return {
		ok: response.status >= 200 && response.status < 300,
		status: response.status,
		headers: response.headers,
		arrayBuffer: async () => Uint8Array.from(response.body).buffer,
	};
}
