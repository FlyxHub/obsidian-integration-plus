import { BrowserWindow } from "@electron/remote";
import {
	mathImageHtml,
	rasterizeMathImage,
	validateMermaidOptions,
	type ChartData,
	type MathExpression,
	type MathRenderer,
	type MermaidOptions,
	type MermaidRenderer,
} from "@markdown-confluence/lib";
import type { MermaidConfig } from "mermaid";
import { loadMermaid } from "obsidian";
import type { ObsidianMermaid } from "./mermaidStyles";

/*
 * Renderers for publishing, adapted from `@markdown-confluence/mermaid-electron-renderer`
 * 7.0.0 (Apache 2.0). Diagrams use the Mermaid that Obsidian ships instead of a bundled
 * copy, which kept main.js too large to sync. Both render in hidden Electron windows.
 */

/** Theme variable values that Mermaid can't compute colors from; fonts may use them. */
const CSS_FUNCTION = /\b(?:color-mix|light-dark|var)\(/iu;
const FONT_VARIABLE = /^font/iu;

const DEFAULT_MERMAID_CONFIG: MermaidConfig = {
	theme: "base",
	themeVariables: {
		background: "#ffffff",
		mainBkg: "#ddebff",
		primaryColor: "#ddebff",
		primaryTextColor: "#192b50",
		primaryBorderColor: "#0052cc",
		secondaryColor: "#ff8f73",
		secondaryTextColor: "#192b50",
		secondaryBorderColor: "#df360c",
		tertiaryColor: "#c0b6f3",
		tertiaryTextColor: "#fefefe",
		tertiaryBorderColor: "#5243aa",
		noteBkgColor: "#ffc403",
		noteTextColor: "#182a4e",
		textColor: "#ff0000",
		titleColor: "#0052cc",
	},
};

type ThemeVariables = Record<string, unknown>;

/** Split off the theme variables, dropping those that are CSS functions but keeping fonts. */
function splitThemeVariables(config: MermaidConfig): {
	config: MermaidConfig;
	themeVariables: ThemeVariables | undefined;
} {
	const rest = { ...config };
	const variables = rest.themeVariables as ThemeVariables | undefined;
	delete rest.themeVariables;
	const kept = Object.fromEntries(
		Object.entries(variables ?? {}).filter(
			([name, value]) =>
				!(typeof value === "string" && !FONT_VARIABLE.test(name) && CSS_FUNCTION.test(value)),
		),
	);
	return { config: rest, themeVariables: Object.keys(kept).length > 0 ? kept : undefined };
}

export class ElectronMathRenderer implements MathRenderer {
	async captureMath(expressions: MathExpression[]): Promise<Map<string, Buffer>> {
		const images = new Map<string, Buffer>();
		if (!expressions.length) return images;
		const window = new BrowserWindow({
			width: 2048,
			height: 1024,
			show: false,
			frame: false,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
				backgroundThrottling: false,
			},
		});
		try {
			for (const expression of expressions) {
				await window.loadURL(
					`data:text/html;charset=utf-8,${encodeURIComponent(mathImageHtml(expression))}`,
				);
				const dataUrl = (await window.webContents.executeJavaScript(
					`(${rasterizeMathImage.toString()})()`,
				)) as string;
				images.set(expression.name, Buffer.from(dataUrl.split(",")[1] ?? "", "base64"));
			}
		} finally {
			window.close();
		}
		return images;
	}
}

export class ElectronMermaidRenderer implements MermaidRenderer {
	readonly format: "png" | "svg";

	constructor(
		private readonly extraStyleSheets: string[],
		private readonly extraStyles: string[],
		private readonly mermaidConfig: MermaidConfig = DEFAULT_MERMAID_CONFIG,
		private readonly bodyClasses = "",
		private readonly renderOptions: MermaidOptions = {},
	) {
		validateMermaidOptions(renderOptions);
		this.format = renderOptions.format ?? "png";
	}

	async captureMermaidCharts(charts: ChartData[]): Promise<Map<string, Buffer>> {
		const mermaid = (await loadMermaid()) as ObsidianMermaid;
		const pageUrl = URL.createObjectURL(this.pageBlob());
		const images = new Map<string, Buffer>();
		// Obsidian renders notes with this same Mermaid, so put its configuration back after.
		const obsidianConfig = mermaid.mermaidAPI.getConfig();
		try {
			const { config, themeVariables } = splitThemeVariables({
				...this.mermaidConfig,
				...(this.renderOptions.theme ? { theme: this.renderOptions.theme } : {}),
				themeVariables: {
					...(this.mermaidConfig.themeVariables as ThemeVariables | undefined),
					...this.renderOptions.themeVariables,
				},
				securityLevel: "strict",
			});
			mermaid.initialize({
				...config,
				...(themeVariables ? { themeVariables } : {}),
				startOnLoad: false,
				suppressErrorRendering: true,
			});
			for (const chart of charts) {
				const window = new BrowserWindow({ width: 800, height: 600, show: false, frame: false });
				try {
					await window.loadURL(pageUrl);
					const id = "mm" + crypto.randomUUID().replace(/-/g, "");
					const { svg } = await mermaid.render(id, chart.data);
					if (this.format === "svg") {
						images.set(chart.name, Buffer.from(svg));
						continue;
					}
					const scale = this.renderOptions.scale ?? 1;
					window.webContents.setZoomFactor(scale);
					const size = (await window.webContents.executeJavaScript(
						`renderSvg(${JSON.stringify(svg)});`,
					)) as { width: number; height: number };
					const rect = {
						x: 0,
						y: 0,
						width: Math.ceil(size.width * scale),
						height: Math.ceil(size.height * scale),
					};
					window.setSize(rect.width, rect.height);
					const image = await window.webContents.capturePage(rect, {
						stayHidden: true,
						stayAwake: true,
					});
					images.set(chart.name, image.toPNG());
				} finally {
					window.close();
				}
			}
			return images;
		} finally {
			mermaid.initialize(obsidianConfig);
			URL.revokeObjectURL(pageUrl);
		}
	}

	/** The hidden page each diagram is drawn in, styled like the chosen theme. */
	private pageBlob(): Blob {
		const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Mermaid Chart</title>
	${this.extraStyleSheets.map((sheet) => `<link href="${sheet}" type="text/css" rel="stylesheet"/>`).join("\n")}
	${`
		<style>
		${this.extraStyles.join("\n")}
		</style>`}
  </head>
  <body class="${this.bodyClasses}">
  	<div id="graphDiv"></div>
    <script type="text/javascript">
	window.renderSvg = (svg) => {
        const chartElement = document.querySelector("#graphDiv");
        chartElement.innerHTML = svg;

        const svgElement = document.querySelector("#graphDiv svg");
        return {
            width: svgElement.scrollWidth,
            height: svgElement.scrollHeight,
        };
    }
	</script>
  </body>
</html>
`;
		return new Blob([html], { type: "text/html" });
	}
}
