import { expect, test } from "@effect/vitest";
import { AlwaysADFProcessingPlugins, executeADFProcessingPipeline } from "@markdown-confluence/lib";
import { keepHostedMedia } from "./hostedMedia";

const hosted = {
	type: "media",
	attrs: {
		type: "file",
		id: "6e6a660c-ae01-41f0-8022-6b30b60df4bd",
		collection: "contentId-5",
		height: 386,
	},
};
const doc = () => ({
	type: "doc" as const,
	version: 1,
	content: [
		{ type: "mediaSingle", attrs: { layout: "center" }, content: [structuredClone(hosted)] },
	],
});
/** Only called for `file://` addresses, which this document has none of. */
const uploader = {} as Parameters<typeof executeADFProcessingPipeline>[2];

test("media that Confluence already hosts passes the attachment uploader untouched", async () => {
	// Without the plugin, the lib's uploader splits the missing address and fails the publish.
	await expect(
		executeADFProcessingPipeline([...AlwaysADFProcessingPlugins], doc(), uploader),
	).rejects.toThrow("split");
	const result = await executeADFProcessingPipeline(
		[keepHostedMedia(), ...AlwaysADFProcessingPlugins],
		doc(),
		uploader,
	);
	expect(result.content?.[0]?.content?.[0]).toEqual(hosted);
});
