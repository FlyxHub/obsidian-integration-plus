/** The parts of a DOM element that `svgResourceProblem` reads. */
export interface SvgNode {
	localName: string;
	textContent: string | null;
	attributes: ArrayLike<{ localName: string; value: string }>;
	querySelectorAll(selectors: "*"): ArrayLike<SvgNode>;
}

/**
 * Why the SVG could load something, or undefined if it is self-contained. Published SVG is
 * also opened outside the render window's CSP, so it may not contain active elements or
 * external references. Adapted from upstream's `assertSelfContainedSvg` (7.0.1). Runs in the
 * render window, serialized with `toString()`, so it must not use anything outside itself.
 */
export function svgResourceProblem(svgElement: SvgNode): string | undefined {
	const forbiddenElements = new Set(
		(
			"script iframe object embed link base meta image feimage audio video source animate " +
			"animatemotion animatetransform set form input button select textarea"
		).split(" "),
	);
	const resourceAttributes = new Set(
		(
			"src srcset base srcdoc action formaction background poster data codebase archive " +
			"manifest profile longdesc ping"
		).split(" "),
	);
	const cssProblem = (css: string) => {
		// Escapes and comments can hide URL tokens; Mermaid's own styles use neither.
		if (/\\|\/\*|@import|(?:image-set|image|src|paint|element)\s*\(/iu.test(css))
			return "unsupported CSS";
		for (const match of css.matchAll(/url\s*\(([^)]*)\)/giu))
			if (!/^\s*["']?#[a-zA-Z_][\w:.-]*["']?\s*$/u.test(match[1] ?? "")) return "external CSS URL";
		return undefined;
	};
	for (const element of [svgElement, ...Array.from(svgElement.querySelectorAll("*"))]) {
		const name = element.localName.toLowerCase();
		if (forbiddenElements.has(name)) return `<${name}> element`;
		const styleProblem = name === "style" ? cssProblem(element.textContent ?? "") : undefined;
		if (styleProblem) return styleProblem;
		for (const attribute of Array.from(element.attributes)) {
			const attributeName = attribute.localName.toLowerCase();
			if (attributeName.startsWith("on") || resourceAttributes.has(attributeName))
				return `${attributeName} attribute`;
			if (attributeName === "href" && !/^#[a-zA-Z_][\w:.-]*$/u.test(attribute.value))
				return "external reference";
			// URL-valued presentation attributes (fill, filter, marker-end) need the CSS checks too.
			const valueProblem =
				attributeName === "style" || /url\s*\(|\\/iu.test(attribute.value)
					? cssProblem(attribute.value)
					: undefined;
			if (valueProblem) return valueProblem;
		}
	}
	return undefined;
}
