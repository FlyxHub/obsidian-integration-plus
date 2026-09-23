import { Modal, App, FrontMatterCache } from "obsidian";
import { ConfluencePageConfig } from "@markdown-confluence/lib";

type PageConfig = ConfluencePageConfig.ConfluencePerPageConfig;
type PageConfigKey = keyof PageConfig;

/** The per-page frontmatter settings the form edits, as the lib defines them. */
const config = ConfluencePageConfig.conniePerPageConfig;

export type ConfluencePerPageUIValues = {
	[K in PageConfigKey]: {
		value: PageConfig[K]["default"] | undefined;
		isSet: boolean;
	};
};

type FieldValue = string | boolean | string[] | undefined;
type FieldState = { value: FieldValue; isSet: boolean };
type Field = ConfluencePageConfig.FrontmatterConfig<unknown, ConfluencePageConfig.InputType>;

/** Frontmatter is user-edited YAML, so coerce each value to what its input can display. */
function toFieldValue(inputType: ConfluencePageConfig.InputType, value: unknown): FieldValue {
	switch (inputType) {
		case "boolean":
			return value === true;
		case "array-text":
			if (Array.isArray(value)) return value.map(String);
			return typeof value === "string" && value ? [value] : [];
		case "text":
		case "options":
			if (typeof value === "string") return value;
			return typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
	}
}

function selectOptionsOf(field: object): string[] {
	const options: unknown = "selectOptions" in field ? field.selectOptions : undefined;
	return Array.isArray(options) ? options.filter((option) => typeof option === "string") : [];
}

export function mapFrontmatterToConfluencePerPageUIValues(
	frontmatter: FrontMatterCache | undefined,
): ConfluencePerPageUIValues {
	const result: Record<string, FieldState> = {};

	for (const property of Object.keys(config) as PageConfigKey[]) {
		const { key, inputType, default: defaultValue } = config[property];
		const frontmatterValue: unknown = frontmatter?.[key];
		const isSet = frontmatterValue !== undefined;
		const fallback =
			inputType === "options" || inputType === "array-text" ? defaultValue : undefined;
		result[property] = {
			value: toFieldValue(inputType, isSet ? frontmatterValue : fallback),
			isSet,
		};
	}
	return result as ConfluencePerPageUIValues;
}

interface ModalProps {
	initialValues: ConfluencePerPageUIValues;
	onSubmit: (values: ConfluencePerPageUIValues, close: () => void) => Promise<void> | void;
}

/** Render a field's input into `containerEl`, calling `onChange` with each new value. */
function renderInput(
	containerEl: HTMLElement,
	id: string,
	field: Field,
	value: FieldValue,
	onChange: (value: FieldValue) => void,
) {
	switch (field.inputType) {
		case "boolean": {
			const input = containerEl.createEl("input", { type: "checkbox", attr: { id } });
			input.checked = value === true;
			input.addEventListener("change", () => onChange(input.checked));
			return;
		}
		case "options": {
			const select = containerEl.createEl("select", { cls: "dropdown", attr: { id } });
			for (const option of selectOptionsOf(field))
				select.createEl("option", { text: option, value: option });
			select.value = typeof value === "string" ? value : "";
			// Show the first option when the value matches none, as a new select does.
			if (select.selectedIndex === -1 && select.options.length > 0) select.selectedIndex = 0;
			select.addEventListener("change", () => onChange(select.value));
			return;
		}
		case "array-text": {
			const items = Array.isArray(value) ? [...value] : [];
			const wrapper = containerEl.createDiv({ cls: "confluence-array-input" });
			items.forEach((item, index) => {
				const input = wrapper.createEl("input", {
					type: "text",
					value: item,
					attr: { "aria-label": `${field.key} ${index + 1}` },
				});
				input.addEventListener("input", () => {
					items[index] = input.value;
					onChange([...items]);
				});
			});
			const add = wrapper.createEl("button", {
				text: "+",
				attr: { type: "button", "aria-label": `Add ${field.key} value` },
			});
			add.addEventListener("click", () => {
				onChange([...items, ""]);
				containerEl.empty();
				renderInput(containerEl, id, field, [...items, ""], onChange);
			});
			return;
		}
		case "text": {
			const input = containerEl.createEl("input", {
				type: "text",
				value: typeof value === "string" ? value : "",
				attr: { id },
			});
			input.addEventListener("input", () => onChange(input.value));
			return;
		}
	}
}

export class ConfluencePerPageForm extends Modal {
	constructor(
		app: App,
		private readonly modalProps: ModalProps,
	) {
		super(app);
	}

	override onOpen() {
		this.setTitle("Confluence page settings");
		const values: Record<string, FieldState> = { ...this.modalProps.initialValues };
		const errors = new Map<PageConfigKey, Error[]>();

		const form = this.contentEl.createEl("form", { cls: "confluence-page-settings" });
		const table = form.createEl("table");
		const head = table.createEl("thead").createEl("tr");
		for (const text of ["Property", "Value", "Set"]) head.createEl("th", { text });
		const body = table.createEl("tbody");
		const save = form
			.createDiv({ cls: "modal-button-container" })
			.createEl("button", { text: "Save", cls: "mod-cta", attr: { type: "submit" } });

		for (const property of Object.keys(config) as PageConfigKey[]) {
			const field = config[property] as Field;
			const row = body.createEl("tr");
			row.createEl("td").createEl("label", { text: field.key, attr: { for: property } });
			const valueCell = row.createEl("td");
			let errorRow: HTMLElement | undefined;

			const update = (change: Partial<FieldState>) => {
				const next = { ...values[property]!, ...change };
				values[property] = next;
				const validation = config[property].inputValidator(next.value);
				errors.set(property, validation.valid ? [] : validation.errors);
				errorRow?.remove();
				errorRow = undefined;
				if (!validation.valid && validation.errors.length > 0) {
					errorRow = createEl("tr");
					const cell = errorRow.createEl("td", {
						cls: "confluence-field-error",
						attr: { colspan: "3" },
					});
					for (const error of validation.errors) cell.createEl("p", { text: error.message });
					row.after(errorRow);
				}
				save.disabled = [...errors.values()].some((list) => list.length > 0);
			};

			renderInput(valueCell, property, field, values[property]!.value, (value) =>
				update({ value }),
			);
			const setInput = row.createEl("td").createEl("input", {
				type: "checkbox",
				attr: { "aria-label": `Write ${field.key} to frontmatter` },
			});
			setInput.checked = values[property]!.isSet;
			setInput.addEventListener("change", () => update({ isSet: setInput.checked }));
		}

		form.addEventListener("submit", (event) => {
			event.preventDefault();
			void this.modalProps.onSubmit(values as ConfluencePerPageUIValues, () => this.close());
		});
	}

	override onClose() {
		this.contentEl.empty();
	}
}
