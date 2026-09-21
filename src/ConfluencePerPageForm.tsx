import { Modal, App, FrontMatterCache } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { StrictMode, useState, type SyntheticEvent } from "react";
import { ConfluencePageConfig } from "@markdown-confluence/lib";

type PageConfig = ConfluencePageConfig.ConfluencePerPageConfig;
type PageConfigKey = keyof PageConfig;

export type ConfluencePerPageUIValues = {
	[K in PageConfigKey]: {
		value: PageConfig[K]["default"] | undefined;
		isSet: boolean;
	};
};

type FieldValue = string | boolean | string[] | undefined;

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
	const config = ConfluencePageConfig.conniePerPageConfig;
	const result: Record<string, { value: FieldValue; isSet: boolean }> = {};

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
	config: PageConfig;
	initialValues: ConfluencePerPageUIValues;
	onSubmit: (values: ConfluencePerPageUIValues, close: () => void) => Promise<void> | void;
}

interface FormProps {
	config: PageConfig;
	initialValues: ConfluencePerPageUIValues;
	onSubmit: (values: ConfluencePerPageUIValues) => void;
}

interface FieldProps {
	id: string;
	field: ConfluencePageConfig.FrontmatterConfig<unknown, ConfluencePageConfig.InputType>;
	value: FieldValue;
	onChange: (value: FieldValue) => void;
}

const FieldInput = ({ id, field, value, onChange }: FieldProps) => {
	switch (field.inputType) {
		case "boolean":
			return (
				<input
					type="checkbox"
					id={id}
					checked={value === true}
					onChange={(e) => onChange(e.target.checked)}
				/>
			);
		case "options": {
			const selectOptions = selectOptionsOf(field);
			return (
				<select
					className="dropdown"
					id={id}
					value={typeof value === "string" ? value : ""}
					onChange={(e) => onChange(e.target.value)}
				>
					{selectOptions.map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			);
		}
		case "array-text": {
			const items = Array.isArray(value) ? value : [];
			return (
				<div className="confluence-array-input">
					{items.map((item, index) => (
						<input
							key={index}
							type="text"
							aria-label={`${field.key} ${index + 1}`}
							value={item}
							onChange={(e) =>
								onChange(items.map((old, i) => (i === index ? e.target.value : old)))
							}
						/>
					))}
					<button
						type="button"
						aria-label={`Add ${field.key} value`}
						onClick={() => onChange([...items, ""])}
					>
						+
					</button>
				</div>
			);
		}
		case "text":
			return (
				<input
					type="text"
					id={id}
					value={typeof value === "string" ? value : ""}
					onChange={(e) => onChange(e.target.value)}
				/>
			);
	}
};

const ConfluenceForm = ({ config, initialValues, onSubmit }: FormProps) => {
	const [values, setValues] = useState(initialValues);
	const [errors, setErrors] = useState<Partial<Record<PageConfigKey, Error[]>>>({});

	const update = (property: PageConfigKey, change: { value?: FieldValue; isSet?: boolean }) => {
		const next = { ...values[property], ...change };
		setValues((previous) => ({ ...previous, [property]: next }));
		const validation = config[property].inputValidator(next.value);
		setErrors((previous) => ({
			...previous,
			[property]: validation.valid ? [] : validation.errors,
		}));
	};

	const handleSubmit = (e: SyntheticEvent) => {
		e.preventDefault();
		onSubmit(values);
	};

	const hasErrors = Object.values(errors).some((list) => list.length > 0);

	return (
		<form className="confluence-page-settings" onSubmit={handleSubmit}>
			<table>
				<thead>
					<tr>
						<th>Property</th>
						<th>Value</th>
						<th>Set</th>
					</tr>
				</thead>
				<tbody>
					{(Object.keys(config) as PageConfigKey[]).map((property) => {
						const field = config[property] as FieldProps["field"];
						const fieldErrors = errors[property] ?? [];
						return [
							<tr key={property}>
								<td>
									<label htmlFor={property}>{field.key}</label>
								</td>
								<td>
									<FieldInput
										id={property}
										field={field}
										value={values[property].value}
										onChange={(value) => update(property, { value })}
									/>
								</td>
								<td>
									<input
										type="checkbox"
										aria-label={`Write ${field.key} to frontmatter`}
										checked={values[property].isSet}
										onChange={(e) => update(property, { isSet: e.target.checked })}
									/>
								</td>
							</tr>,
							fieldErrors.length > 0 && (
								<tr key={`${property}-errors`}>
									<td colSpan={3} className="confluence-field-error">
										{fieldErrors.map((error) => (
											<p key={error.message}>{error.message}</p>
										))}
									</td>
								</tr>
							),
						];
					})}
				</tbody>
			</table>
			<div className="modal-button-container">
				<button type="submit" className="mod-cta" disabled={hasErrors}>
					Save
				</button>
			</div>
		</form>
	);
};

export class ConfluencePerPageForm extends Modal {
	private readonly modalProps: ModalProps;
	private root: Root | null = null;

	constructor(app: App, modalProps: ModalProps) {
		super(app);
		this.modalProps = modalProps;
	}

	override onOpen() {
		this.setTitle("Confluence page settings");
		const onSubmit = (values: ConfluencePerPageUIValues) => {
			void this.modalProps.onSubmit(values, () => this.close());
		};
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<ConfluenceForm
					config={this.modalProps.config}
					initialValues={this.modalProps.initialValues}
					onSubmit={onSubmit}
				/>
			</StrictMode>,
		);
	}

	override onClose() {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}
