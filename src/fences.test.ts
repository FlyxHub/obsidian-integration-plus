import { expect, test } from "@effect/vitest";
import { createFenceTracker } from "./fences";

test("marks fence lines and code between them, including quoted and longer fences", () => {
	const inCode = createFenceTracker();
	const lines = [
		"text",
		"````md",
		"```",
		"still code",
		"````",
		"> ~~~",
		"> quoted",
		"> ~~~",
		"after",
	];
	expect(lines.map(inCode)).toEqual([false, true, true, true, true, true, true, true, false]);
});
