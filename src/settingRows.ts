import { Setting, type SettingDefinitionItem } from "obsidian";

/**
 * One setting, described once for both ways a settings tab can render. Obsidian 1.13.0 and
 * later build the tab from `getSettingDefinitions()`, which also makes settings searchable;
 * older versions call `display()`, which renders the same rows with `renderSections`.
 */
export interface SettingRow {
	name: string;
	desc?: string;
	/** Rows without a real name, such as notes, stay out of settings search. */
	searchable?: boolean;
	/** Add the controls to a setting that already has the name and description. */
	render: (setting: Setting) => unknown;
}

export interface SettingSection {
	heading?: string;
	rows: SettingRow[];
}

/** The sections as declarative definitions for Obsidian 1.13.0 and later. */
export function toDefinitions(sections: SettingSection[]): SettingDefinitionItem[] {
	return sections.map(({ heading, rows }) => ({
		type: "group",
		...(heading ? { heading } : {}),
		items: rows.map(({ name, desc, searchable, render }) => ({
			name,
			...(desc ? { desc } : {}),
			...(searchable === false ? { searchable } : {}),
			render: (setting: Setting) => {
				render(setting);
			},
		})),
	}));
}

/** Render the sections imperatively, for Obsidian versions before 1.13.0. */
export function renderSections(containerEl: HTMLElement, sections: SettingSection[]) {
	for (const { heading, rows } of sections) {
		if (heading) new Setting(containerEl).setName(heading).setHeading();
		for (const row of rows) {
			const setting = new Setting(containerEl).setName(row.name);
			if (row.desc) setting.setDesc(row.desc);
			row.render(setting);
		}
	}
}

/** A row that shows only its own content, such as a paragraph of explanation. */
export function contentRow(
	name: string,
	cls: string,
	fill: (containerEl: HTMLElement) => void,
): SettingRow {
	return {
		name,
		searchable: false,
		render: (setting) => {
			setting.settingEl.empty();
			setting.settingEl.addClass(cls);
			fill(setting.settingEl);
		},
	};
}
