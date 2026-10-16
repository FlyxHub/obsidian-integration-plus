import { test, expect } from "@effect/vitest";
import { createServer } from "node:http";
import { krokiFetch, plantumlFetch } from "./KrokiFetch";
import { nodeRequest } from "./nodeRequest";

test("desktop Kroki transport preserves image bytes, rejects redirects and honors abort", async () => {
	const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
	const server = createServer((request, response) => {
		if (request.url === "/redirect") {
			response.writeHead(302, { location: "/image" });
			response.end();
			return;
		}
		if (request.url === "/slow") return;
		expect(request.method).toBe("POST");
		expect(request.headers.authorization).toBeUndefined();
		response.writeHead(200, { "content-type": "image/png" });
		response.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test address");
		const base = `http://127.0.0.1:${address.port}`;
		const response = await krokiFetch(base + "/image", { method: "POST", body: "{}" });
		expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
		expect(response.headers.get("content-type")).toBe("image/png");
		await expect(krokiFetch(base + "/redirect", {})).rejects.toThrow("redirects");
		const controller = new AbortController();
		const pending = krokiFetch(base + "/slow", { signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toThrow();
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

test("PlantUML transport follows redirects and stalled diagram requests end", async () => {
	const server = createServer((request, response) => {
		if (request.url === "/old/png/x") {
			response.writeHead(301, { location: "/plantuml/png/x" });
			response.end();
			return;
		}
		if (request.url === "/elsewhere/png/x") {
			response.writeHead(302, {
				location: `http://localhost:${request.headers.host?.split(":")[1]}/png/x`,
			});
			response.end();
			return;
		}
		if (request.url === "/stall") {
			response.writeHead(200);
			response.write("partial");
			return;
		}
		response.writeHead(200, { "content-type": "image/png" });
		response.end("PNG");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test address");
		const base = `http://127.0.0.1:${address.port}`;
		const response = await plantumlFetch(`${base}/old/png/x`);
		expect(response.ok).toBe(true);
		expect(await response.text()).toBe("PNG");
		await expect(
			nodeRequest(`${base}/stall`, { allowHttp: true, idleTimeoutMs: 50 }),
		).rejects.toThrow("stopped responding");
		// A redirect may change the path or scheme, but not the host.
		await expect(plantumlFetch(`${base}/elsewhere/png/x`)).rejects.toThrow("another host");
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
