import { App, Vault, loadMermaid, normalizePath } from "obsidian";
import type { MermaidConfig } from "mermaid";
import type { MermaidTheme } from "./settings";

/** What the Electron Mermaid renderer needs to draw diagrams the way the chosen theme looks. */
export interface MermaidStyles {
	extraStyleSheets: string[];
	extraStyles: string[];
	mermaidConfig: MermaidConfig;
	bodyStyles: string;
}

/** The parts of Obsidian's bundled Mermaid that publishing uses. */
export interface ObsidianMermaid {
	initialize(config: MermaidConfig): void;
	render(id: string, text: string): Promise<{ svg: string }>;
	mermaidAPI: { getConfig(): MermaidConfig };
}

/** Undocumented but long-standing Vault API for reading app config such as the active theme. */
type VaultWithConfig = Vault & { getConfig?: (key: string) => unknown };

const MERMAID_OWN_THEMES = ["default", "neutral", "dark", "forest"] as const;
type MermaidOwnTheme = (typeof MERMAID_OWN_THEMES)[number];

/** Body classes for the themes that follow Obsidian's look. */
const OBSIDIAN_BODY_CLASSES: Record<Exclude<MermaidTheme, MermaidOwnTheme>, () => string> = {
	"match-obsidian": () => document.body.className,
	"dark-obsidian": () => "theme-dark",
	"light-obsidian": () => "theme-light",
};

/**
 * Styles for rendering Mermaid diagrams. Mermaid's own themes need nothing else. Obsidian
 * themes copy the app's CSS, the active community theme, enabled snippets and Obsidian's
 * Mermaid config, so published diagrams match the notes.
 */
export async function loadMermaidStyles(app: App, theme: MermaidTheme): Promise<MermaidStyles> {
	if (isMermaidOwnTheme(theme))
		return { extraStyleSheets: [], extraStyles: [], mermaidConfig: { theme }, bodyStyles: "" };

	const bodyStyles = OBSIDIAN_BODY_CLASSES[theme]();
	const cssTheme = getVaultConfig(app, "cssTheme");
	const snippets = getVaultConfig(app, "enabledCssSnippets");
	const cssFiles = [
		...(typeof cssTheme === "string" && cssTheme ? [["themes", cssTheme, "theme.css"]] : []),
		...(Array.isArray(snippets) ? snippets : [])
			.filter((snippet): snippet is string => typeof snippet === "string")
			.map((snippet) => ["snippets", `${snippet}.css`]),
	];
	const css = await Promise.all(cssFiles.map((segments) => readConfigCss(app, segments)));

	const mermaid = (await loadMermaid()) as ObsidianMermaid;
	const mermaidConfig: MermaidConfig = {
		...mermaid.mermaidAPI.getConfig(),
		theme: bodyStyles.split(/\s+/).includes("theme-dark") ? "dark" : "default",
	};
	// Recompute colors for the selected theme instead of reusing Obsidian's
	// previously derived colors, which can leave dark arrows on a dark image.
	delete mermaidConfig.themeVariables;
	return {
		extraStyleSheets: ["app://obsidian.md/app.css"],
		extraStyles: css.filter((text): text is string => !!text),
		mermaidConfig,
		bodyStyles,
	};
}

function isMermaidOwnTheme(theme: MermaidTheme): theme is MermaidOwnTheme {
	return (MERMAID_OWN_THEMES as readonly string[]).includes(theme);
}

function getVaultConfig(app: App, key: string): unknown {
	return (app.vault as VaultWithConfig).getConfig?.(key);
}

/**
 * Read a CSS file from the config directory. The Vault API does not index the config
 * directory, so the adapter is required here. Names come from app config, so any
 * segment that could leave the config directory is rejected.
 */
async function readConfigCss(app: App, segments: string[]): Promise<string | undefined> {
	if (segments.some((segment) => !segment || segment === ".." || /[\\/]/.test(segment)))
		return undefined;
	const path = normalizePath([app.vault.configDir, ...segments].join("/"));
	if (!(await app.vault.adapter.exists(path))) return undefined;
	return app.vault.adapter.read(path);
}
