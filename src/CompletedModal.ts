import { Modal, App } from "obsidian";
import type { UploadAdfFileResult } from "@markdown-confluence/lib";

interface FailedFile {
	fileName: string;
	reason: string;
}

export interface UploadResults {
	errorMessage: string | null;
	failedFiles: FailedFile[];
	filesUploadResult: UploadAdfFileResult[];
}

interface UploadResultsProps {
	uploadResults: UploadResults;
}

/** Page URLs come from the Confluence API; only link to web pages. */
function safePageUrl(url: string | undefined): string | undefined {
	if (!url || !URL.canParse(url)) return undefined;
	return new URL(url).protocol === "https:" ? url : undefined;
}

/** The parts of a page the publisher reports on, with their labels in the results. */
const RESULT_TYPES = [
	{ type: "content", label: "Content" },
	{ type: "image", label: "Images" },
	{ type: "label", label: "Labels" },
] as const;

type ResultType = (typeof RESULT_TYPES)[number]["type"];

function failedList(containerEl: HTMLElement, files: FailedFile[]) {
	const listEl = containerEl.createEl("ul");
	for (const file of files) {
		const item = listEl.createEl("li");
		item.createEl("strong", { text: file.fileName });
		item.appendText(`: ${file.reason}`);
	}
}

function updatedFiles(containerEl: HTMLElement, results: UploadAdfFileResult[], type: ResultType) {
	const listEl = containerEl.createEl("ul");
	for (const result of results) {
		if (result[`${type}Result`] !== "updated") continue;
		const href = safePageUrl(result.adfFile.pageUrl);
		const path = result.adfFile.absoluteFilePath;
		const item = listEl.createEl("li");
		if (href) item.createEl("a", { href, text: path });
		else item.setText(path);
	}
}

export class CompletedModal extends Modal {
	constructor(
		app: App,
		private readonly props: UploadResultsProps,
	) {
		super(app);
	}

	override onOpen() {
		const { errorMessage, failedFiles, filesUploadResult } = this.props.uploadResults;
		this.setTitle(errorMessage ? "Publish failed" : "Publish finished");
		const root = this.contentEl.createDiv({ cls: "confluence-results" });

		if (errorMessage) {
			root.createEl("p", { cls: "confluence-error", text: errorMessage });
			if (failedFiles.length > 0) failedList(root, failedFiles);
			return;
		}

		root.createEl("p", { text: `${filesUploadResult.length} file(s) published successfully.` });
		if (failedFiles.length > 0) {
			const failed = root.createDiv({ cls: "confluence-failed" });
			failed.createEl("p", { text: `${failedFiles.length} file(s) failed to publish:` });
			failedList(failed, failedFiles);
		}

		const count = (type: ResultType, outcome: "same" | "updated") =>
			String(filesUploadResult.filter((result) => result[`${type}Result`] === outcome).length);
		const table = root.createEl("table", { cls: "confluence-results-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const text of ["Type", "Unchanged", "Updated"]) head.createEl("th", { text });
		const body = table.createEl("tbody");
		for (const { type, label } of RESULT_TYPES) {
			const row = body.createEl("tr");
			row.createEl("td", { text: label });
			row.createEl("td", { text: count(type, "same") });
			row.createEl("td", { text: count(type, "updated") });
		}

		const toggle = root.createEl("button", {
			text: "Show updated files",
			attr: { type: "button" },
		});
		let expanded: HTMLElement | undefined;
		toggle.addEventListener("click", () => {
			if (expanded) {
				expanded.remove();
				expanded = undefined;
				toggle.setText("Show updated files");
				return;
			}
			expanded = root.createDiv({ cls: "confluence-updated-files" });
			for (const { type, label } of RESULT_TYPES) {
				const section = expanded.createDiv();
				section.createEl("h4", { text: `Updated ${label.toLowerCase()}` });
				updatedFiles(section, filesUploadResult, type);
			}
			toggle.setText("Hide updated files");
		});
	}

	override onClose() {
		this.contentEl.empty();
	}
}
