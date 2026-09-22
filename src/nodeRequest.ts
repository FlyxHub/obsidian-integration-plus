import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface NodeRequestOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: Uint8Array | string | undefined;
	signal?: AbortSignal | null | undefined;
	/** Allow plain HTTP. Only for user-configured servers that never receive credentials. */
	allowHttp?: boolean;
	/** Fail when the response body grows past this many bytes. */
	maxBytes?: number;
}

export interface NodeResponse {
	status: number;
	statusText: string;
	headers: Headers;
	/** The `Location` header of a redirect response. */
	location: string | undefined;
	body: Buffer;
}

/**
 * One request through Node's HTTP stack, which isn't subject to browser CORS and keeps abort
 * signals. Redirects are never followed: a 3xx answer is returned at once with its `location`
 * and an empty body, and each caller decides what to do with it, so credentials can't be
 * forwarded to another host by accident.
 */
export function nodeRequest(url: string, options: NodeRequestOptions = {}): Promise<NodeResponse> {
	const { protocol } = new URL(url);
	if (protocol !== "https:" && !(options.allowHttp && protocol === "http:"))
		return Promise.reject(new Error(`Requests to ${protocol} URLs aren't allowed; use HTTPS.`));
	return new Promise((resolve, reject) => {
		const outgoing = (protocol === "https:" ? httpsRequest : httpRequest)(
			url,
			{
				method: options.method ?? "GET",
				headers: options.headers ?? {},
				...(options.signal ? { signal: options.signal } : {}),
			},
			(incoming) => {
				const status = incoming.statusCode ?? 0;
				const respond = (body: Buffer) =>
					resolve({
						status,
						statusText: incoming.statusMessage ?? "",
						headers: toHeaders(incoming.headers),
						location: incoming.headers.location,
						body,
					});
				if (isRedirect(status)) {
					incoming.destroy();
					respond(Buffer.alloc(0));
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				incoming.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (options.maxBytes !== undefined && size > options.maxBytes) {
						incoming.destroy();
						reject(new Error(`The response is larger than ${formatMegabytes(options.maxBytes)}.`));
						return;
					}
					chunks.push(chunk);
				});
				incoming.on("error", reject);
				incoming.on("end", () => respond(Buffer.concat(chunks)));
			},
		);
		outgoing.on("error", reject);
		outgoing.end(options.body);
	});
}

export function isRedirect(status: number): boolean {
	return status >= 300 && status < 400;
}

function toHeaders(incoming: Record<string, string | string[] | undefined>): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(incoming))
		if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
	return headers;
}

function formatMegabytes(bytes: number): string {
	return `${Math.round(bytes / (1024 * 1024))} MB`;
}
