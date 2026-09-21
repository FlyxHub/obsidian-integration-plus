import { afterEach, expect, test, vi } from "@effect/vitest";
import { EventEmitter } from "node:events";
import type { RequiredConfluenceClient } from "@markdown-confluence/lib";

vi.doMock("node:https", () => ({ request: vi.fn() }));
const { request } = await import("node:https");
const { assertAtlassianMediaUrl, createAttachmentDownloader } =
	await import("./attachmentDownload");
afterEach(() => vi.clearAllMocks());

const API = "https://example.atlassian.net";

/** Queue canned responses for successive node:https requests, and record what was sent. */
function respondWith(...responses: { status: number; location?: string; body?: string }[]) {
	const sent: { url: string; headers: Record<string, string> }[] = [];
	vi.mocked(request).mockImplementation(((
		url: string,
		options: { headers: Record<string, string> },
		callback: (incoming: unknown) => void,
	) => {
		sent.push({ url, headers: options.headers });
		const next = responses.shift()!;
		const incoming = Object.assign(new EventEmitter(), {
			statusCode: next.status,
			headers: next.location ? { location: next.location } : {},
			destroy: vi.fn(),
		});
		const outgoing = Object.assign(new EventEmitter(), {
			end: () =>
				queueMicrotask(() => {
					callback(incoming);
					if (next.status < 300 || next.status >= 400) {
						incoming.emit("data", Buffer.from(next.body ?? ""));
						incoming.emit("end");
					}
				}),
		});
		return outgoing;
	}) as never);
	return sent;
}

/** A client whose transport calls the downloader's fetch with credentials, like the lib's. */
function clientFor(fetch: ReturnType<typeof createAttachmentDownloader>["fetch"]) {
	return {
		sendRequest: async ({ url }: { url: string }) => {
			const response = await fetch(`${API}${url}`, {
				headers: { Authorization: "Basic secret" },
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		},
	} as unknown as RequiredConfluenceClient;
}

test("follows the media redirect without sending Confluence credentials", async () => {
	const sent = respondWith(
		{ status: 302, location: "https://api.media.atlassian.com/file/abc/binary?token=t" },
		{ status: 200, body: "PNGDATA" },
	);
	const downloader = createAttachmentDownloader(async () => {
		throw new Error("regular requests are not used");
	});
	const bytes = await downloader.download(clientFor(downloader.fetch), "30", "att1");

	expect(Buffer.from(bytes).toString()).toBe("PNGDATA");
	expect(sent[0]?.url).toBe(`${API}/wiki/rest/api/content/30/child/attachment/att1/download`);
	expect(sent[0]?.headers["authorization"]).toBe("Basic secret");
	expect(sent[1]?.url).toBe("https://api.media.atlassian.com/file/abc/binary?token=t");
	expect(sent[1]?.headers).toEqual({});
});

test("refuses redirects to hosts outside Atlassian", async () => {
	respondWith({ status: 302, location: "https://evil.example.com/steal" });
	const downloader = createAttachmentDownloader(async () => {
		throw new Error("unused");
	});
	await expect(downloader.download(clientFor(downloader.fetch), "30", "att1")).rejects.toThrow(
		"unexpected address: evil.example.com",
	);
	expect(request).toHaveBeenCalledOnce();
});

test("passes other Confluence requests to the regular transport", async () => {
	const base = vi.fn(async () => ({
		ok: true,
		status: 200,
		statusText: "",
		text: async () => "{}",
		json: async () => ({ results: [] }),
	}));
	const downloader = createAttachmentDownloader(base);
	await downloader.fetch(`${API}/wiki/api/v2/pages/1/attachments`, {});
	expect(base).toHaveBeenCalledOnce();
	expect(request).not.toHaveBeenCalled();
});

test("only Atlassian HTTPS hosts can serve attachment content", () => {
	expect(() => assertAtlassianMediaUrl("https://api.media.atlassian.com/file/1")).not.toThrow();
	expect(() => assertAtlassianMediaUrl("https://site.atlassian.net/download/1")).not.toThrow();
	expect(() => assertAtlassianMediaUrl("http://api.media.atlassian.com/file/1")).toThrow();
	expect(() => assertAtlassianMediaUrl("https://atlassian.com.evil.io/x")).toThrow();
	expect(() => assertAtlassianMediaUrl("https://user:pw@api.media.atlassian.com/x")).toThrow();
});
