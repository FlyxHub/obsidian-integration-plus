import { App, Modal, Notice, Setting, normalizePath } from "obsidian";
import { confluencePageId } from "./importPageInput";

/** Collect and validate input before starting authenticated import work. */
export class ImportPageModal extends Modal {
	constructor(
		app: App,
		private folder: string,
		private readonly onImport: (pageId: string, folder: string) => Promise<void>,
	) {
		super(app);
	}

	override onOpen() {
		this.setTitle("Import Confluence page");
		let input = "";
		new Setting(this.contentEl).setName("Page URL or ID").addText((text) => {
			text.onChange((value) => {
				input = value;
			});
			text.inputEl.focus();
		});
		new Setting(this.contentEl)
			.setName("Destination folder")
			.setDesc("Leave empty for the vault root. Missing folders will be created.")
			.addText((text) =>
				text.setValue(this.folder).onChange((value) => {
					this.folder = value;
				}),
			);
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Import")
					.setCta()
					.onClick(() => {
						const pageId = confluencePageId(input);
						if (!pageId) {
							new Notice(
								"Enter a numeric Confluence page ID or a full page URL containing /pages/<ID>.",
							);
							return;
						}
						// Reject parent traversal before normalizing the vault-relative folder.
						const folder = this.folder.trim().replaceAll("\\", "/");
						if (folder.split("/").some((part) => part === "..") || folder.includes(":")) {
							new Notice("Enter a destination folder inside the vault.");
							return;
						}
						this.close();
						void this.onImport(pageId, folder && folder !== "." ? normalizePath(folder) : "");
					}),
			);
	}

	override onClose() {
		this.contentEl.empty();
	}
}
