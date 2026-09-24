import MarkdownIt from "markdown-it";

/**
 * The lib's callout rule re-parses a callout's first paragraph after markdown-it's
 * `text_join` rule has run, so an escape (`\>`) or entity (`&amp;`) there stays a
 * `text_special` token, which the lib's parser rejects ("Token type `text_special` not
 * supported by Markdown parser"). This turns the leftovers into text once parsing is done,
 * as `text_join` does. It changes only the markdown-it copy bundled into the plugin.
 * Remove it once the lib's callout rule handles `text_special` itself.
 */
const prototype = MarkdownIt.prototype as MarkdownIt;
// eslint-disable-next-line @typescript-eslint/unbound-method -- called below with its instance
const parse = prototype.parse;
prototype.parse = function (this: MarkdownIt, src, env) {
	const tokens = parse.call(this, src, env);
	for (const token of tokens) {
		for (const child of token.children ?? []) {
			if (child.type === "text_special") child.type = "text";
		}
	}
	return tokens;
};
