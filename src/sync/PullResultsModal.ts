import { App, Modal } from "obsidian";
import type { PullReport } from "./pull";

export class PullResultsModal extends Modal {
	constructor(
		app: App,
		private readonly report: PullReport | { errorMessage: string },
	) {
		super(app);
	}

	override onOpen() {
		const { contentEl } = this;
		contentEl.addClass("confluence-results");
		if ("errorMessage" in this.report) {
			this.setTitle("Pull failed");
			contentEl.createEl("p", { cls: "confluence-error", text: this.report.errorMessage });
			return;
		}
		const report = this.report;
		this.setTitle("Pull finished");
		contentEl.createEl("p", { text: summarizePull(report) });

		if (report.conflicted.length > 0) {
			contentEl.createEl("p", {
				cls: "confluence-error",
				text: "These notes have merge conflicts. Edit each block between the <<<<<<< Obsidian and >>>>>>> Confluence markers, keep the text you want, delete the markers, and then publish.",
			});
			list(contentEl, report.conflicted);
		}
		section(contentEl, "Updated from Confluence", report.updated);
		section(contentEl, "Imported", report.imported);
		section(
			contentEl,
			"Renamed in Confluence (connie-title updated)",
			report.renamed.map(({ path, title }) => `${path} → ${title}`),
		);
		section(contentEl, "Page deleted in Confluence (note kept)", report.deleted);
		section(
			contentEl,
			"Skipped",
			report.skipped.map(({ name, reason }) => `${name}: ${reason}`),
		);
	}

	override onClose() {
		this.contentEl.empty();
	}
}

export function summarizePull(report: PullReport): string {
	const parts = [
		`${report.updated.length} updated`,
		`${report.conflicted.length} with conflicts`,
		`${report.imported.length} imported`,
		`${report.unchanged} unchanged`,
	];
	if (report.skipped.length > 0) parts.push(`${report.skipped.length} skipped`);
	return `Pull finished: ${parts.join(", ")}.`;
}

function section(containerEl: HTMLElement, heading: string, items: string[]) {
	if (items.length === 0) return;
	containerEl.createEl("h4", { text: heading });
	list(containerEl, items);
}

function list(containerEl: HTMLElement, items: string[]) {
	const listEl = containerEl.createEl("ul");
	for (const item of items) listEl.createEl("li", { text: item });
}
