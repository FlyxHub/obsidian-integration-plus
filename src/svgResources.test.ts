import { expect, test } from "@effect/vitest";
import { svgResourceProblem, type SvgNode } from "./svgResources";

/** A minimal element: a name, attributes, text and children. */
const el = (
	localName: string,
	attributes: Record<string, string> = {},
	children: SvgNode[] = [],
	textContent: string | null = null,
): SvgNode => ({
	localName,
	textContent,
	attributes: Object.entries(attributes).map(([name, value]) => ({ localName: name, value })),
	querySelectorAll: () =>
		children.flatMap((child) => [child, ...Array.from(child.querySelectorAll("*"))]),
});
const svg = (...children: SvgNode[]) => el("svg", { viewBox: "0 0 10 10" }, children);

test("accepts what Mermaid draws: shapes, text, styles and in-document references", () => {
	expect(
		svgResourceProblem(
			svg(
				el("style", {}, [], "#a .node rect { fill: #fff; stroke: url(#grad); }"),
				el("marker", { id: "arrow" }),
				el("path", { "marker-end": "url(#arrow)", style: "stroke-width: 2px" }),
				el("use", { href: "#arrow" }),
				el("foreignObject", {}, [el("div", { class: "label" }, [el("span")])]),
			),
		),
	).toBeUndefined();
});

test.each([
	["an image", svg(el("image", { href: "#x" })), "<image> element"],
	["a script", svg(el("g", {}, [el("script")])), "<script> element"],
	["an animation", svg(el("set", { attributeName: "href" })), "<set> element"],
	["an event handler", svg(el("rect", { onclick: "x()" })), "onclick attribute"],
	["a src attribute", svg(el("div", { src: "x.png" })), "src attribute"],
	["an external link", svg(el("a", { href: "https://example.com" })), "external reference"],
	["a local file", svg(el("use", { href: "file:///etc/passwd#a" })), "external reference"],
	["a CSS import", svg(el("style", {}, [], "@import 'x.css';")), "unsupported CSS"],
	["a CSS escape", svg(el("style", {}, [], "a { b: u\\72l(x) }")), "unsupported CSS"],
	["a CSS comment", svg(el("style", {}, [], "a { b: url/**/(x) }")), "unsupported CSS"],
	["a CSS image()", svg(el("style", {}, [], "a { b: image-set('x.png' 1x) }")), "unsupported CSS"],
	["an external CSS URL", svg(el("style", {}, [], "a { b: url(https://x) }")), "external CSS URL"],
	[
		"a URL in a style attribute",
		svg(el("rect", { style: "fill: url('x.svg#a')" })),
		"external CSS URL",
	],
	[
		"a URL in a presentation attribute",
		svg(el("rect", { filter: "url(x.svg#f)" })),
		"external CSS URL",
	],
	["a forbidden root", el("iframe"), "<iframe> element"],
])("rejects %s", (_name, root, problem) => {
	expect(svgResourceProblem(root)).toBe(problem);
});
