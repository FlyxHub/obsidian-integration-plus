import { expect, test } from "@effect/vitest";
import { AlwaysADFProcessingPlugins, executeADFProcessingPipeline } from "@markdown-confluence/lib";

/** A pulled `adf` block's image: Confluence names the attachment by `id`, with no `url`. */
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

// Lib 7.0.0's uploader split the missing address and failed the publish; 7.0.1 skips such nodes.
test("media that Confluence already hosts passes the attachment uploader untouched", async () => {
	const result = await executeADFProcessingPipeline(
		[...AlwaysADFProcessingPlugins],
		doc(),
		uploader,
	);
	expect(result.content?.[0]?.content?.[0]).toEqual(hosted);
});
