import { BrowserWindow, session } from "@electron/remote";
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
import { loadMermaid } from "obsidian";
import { svgResourceProblem } from "./svgResources";
import { mermaidSiteConfig, type MermaidStyles, type ObsidianMermaid } from "./mermaidStyles";

/*
 * Renderers for publishing, adapted from `@markdown-confluence/mermaid-electron-renderer`
 * 7.0.1 (Apache 2.0). Diagrams use the Mermaid that Obsidian ships instead of a bundled
 * copy, which kept main.js too large to sync. Both render in hidden Electron windows.
 */

/** Theme variable values that Mermaid can't compute colors from; fonts may use them. */
const CSS_FUNCTION = /\b(?:color-mix|light-dark|var)\(/iu;
const FONT_VARIABLE = /^font/iu;

/**
 * The page each diagram is drawn in. Its CSP allows no scripts or resources; styles are
 * added with `insertCSS` and the diagram with `drawSvg`.
 */
const RENDER_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(
	`<!DOCTYPE html><html><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" /><title>Mermaid chart</title></head><body><div id="graphDiv"></div></body></html>`,
)}`;

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

/**
 * Runs in the render window, serialized with `toString()` and given that window's `document`:
 * draws Mermaid's SVG, checks it with `problem` (`svgResourceProblem`), and returns its size
 * and markup.
 */
function drawSvg(
	page: Document,
	problem: (svg: Element) => string | undefined,
	svg: string,
	bodyClasses: string,
): { width: number; height: number; svg: string } {
	page.body.className = bodyClasses;
	const svgElement = new DOMParser().parseFromString(svg, "text/html").querySelector("svg");
	if (!svgElement) throw new Error("Mermaid returned no SVG");
	page.getElementById("graphDiv")?.replaceChildren(page.importNode(svgElement, true));
	const drawn = page.querySelector("#graphDiv svg");
	if (!drawn) throw new Error("Mermaid returned no SVG");
	const reason = problem(drawn);
	if (reason) throw new Error(`Mermaid diagrams must be self-contained: ${reason}`);
	const box = drawn.getBoundingClientRect();
	return {
		width: Math.max(1, Math.ceil(box.width)),
		height: Math.max(1, Math.ceil(box.height)),
		svg: drawn.outerHTML,
	};
}

export class ElectronMermaidRenderer implements MermaidRenderer {
	readonly format: "png" | "svg";
	/** The publisher renders pages in parallel, but Obsidian's Mermaid has one configuration. */
	private rendering: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly styles: MermaidStyles,
		private readonly renderOptions: MermaidOptions = {},
	) {
		validateMermaidOptions(renderOptions);
		this.format = renderOptions.format ?? "png";
	}

	captureMermaidCharts(charts: ChartData[]): Promise<Map<string, Buffer>> {
		const result = this.rendering.then(() => this.render(charts));
		this.rendering = result.catch(() => undefined);
		return result;
	}

	private async render(charts: ChartData[]): Promise<Map<string, Buffer>> {
		const images = new Map<string, Buffer>();
		if (!charts.length) return images;
		const mermaid = (await loadMermaid()) as ObsidianMermaid;
		// A private, in-memory session for this render. It cancels every request except the page
		// itself (images, fonts, CSS imports, app:// files) and grants no permissions.
		const renderSession = session.fromPartition(`mermaid-${crypto.randomUUID()}`, {
			cache: false,
		});
		renderSession.webRequest.onBeforeRequest((details, callback) => {
			callback({ cancel: details.url !== RENDER_PAGE || details.resourceType !== "mainFrame" });
		});
		renderSession.setPermissionRequestHandler((_contents, _permission, callback) =>
			callback(false),
		);
		renderSession.setPermissionCheckHandler(() => false);
		const css = this.styles.extraStyles.join("\n");
		// Obsidian renders notes with this same Mermaid, so put its configuration back after.
		const obsidianConfig = mermaidSiteConfig(mermaid);
		try {
			// Drop theme variables that are CSS functions, which Mermaid can't compute colors from.
			const themeVariables = Object.fromEntries(
				Object.entries(this.renderOptions.themeVariables ?? {}).filter(
					([name, value]) =>
						!(typeof value === "string" && !FONT_VARIABLE.test(name) && CSS_FUNCTION.test(value)),
				),
			);
			mermaid.initialize({
				...this.styles.mermaidConfig,
				...(this.renderOptions.theme ? { theme: this.renderOptions.theme } : {}),
				...(Object.keys(themeVariables).length > 0 ? { themeVariables } : {}),
				securityLevel: "strict",
				startOnLoad: false,
				suppressErrorRendering: true,
			});
			for (const chart of charts) {
				const window = new BrowserWindow({
					width: 800,
					height: 600,
					show: false,
					frame: false,
					webPreferences: {
						session: renderSession,
						nodeIntegration: false,
						contextIsolation: true,
						sandbox: true,
						webSecurity: true,
						allowRunningInsecureContent: false,
						backgroundThrottling: false,
						spellcheck: false,
					},
				});
				try {
					window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
					window.webContents.on("will-navigate", (event) => event.preventDefault());
					window.webContents.on("will-redirect", (event) => event.preventDefault());
					await window.loadURL(RENDER_PAGE);
					if (css) await window.webContents.insertCSS(css);
					const id = "mm" + crypto.randomUUID().replace(/-/g, "");
					const { svg } = await mermaid.render(id, chart.data);
					const drawn = (await window.webContents.executeJavaScript(
						`(${drawSvg.toString()})(document, ${svgResourceProblem.toString()},${JSON.stringify(svg)}, ${JSON.stringify(this.styles.bodyStyles)})`,
					)) as { width: number; height: number; svg: string };
					if (this.format === "svg") {
						images.set(chart.name, Buffer.from(drawn.svg));
						continue;
					}
					const scale = this.renderOptions.scale ?? 1;
					window.webContents.setZoomFactor(scale);
					const rect = {
						x: 0,
						y: 0,
						width: Math.ceil(drawn.width * scale),
						height: Math.ceil(drawn.height * scale),
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
			renderSession.webRequest.onBeforeRequest(null);
			await renderSession.closeAllConnections();
			await renderSession.clearStorageData();
		}
	}
}
