import { Modal, App } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { StrictMode, useState } from "react";
import { UploadAdfFileResult } from "@markdown-confluence/lib";

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

const FailedList = ({ files }: { files: FailedFile[] }) => (
	<ul>
		{files.map((file) => (
			<li key={file.fileName}>
				<strong>{file.fileName}</strong>: {file.reason}
			</li>
		))}
	</ul>
);

const UpdatedFiles = ({ results, type }: { results: UploadAdfFileResult[]; type: ResultType }) => (
	<ul>
		{results
			.filter((result) => result[`${type}Result`] === "updated")
			.map((result) => {
				const href = safePageUrl(result.adfFile.pageUrl);
				const path = result.adfFile.absoluteFilePath;
				return <li key={path}>{href ? <a href={href}>{path}</a> : path}</li>;
			})}
	</ul>
);

const CompletedView = ({ uploadResults }: UploadResultsProps) => {
	const { errorMessage, failedFiles, filesUploadResult } = uploadResults;
	const [expanded, setExpanded] = useState(false);

	if (errorMessage) {
		return (
			<div className="confluence-results">
				<p className="confluence-error">{errorMessage}</p>
				{failedFiles.length > 0 && <FailedList files={failedFiles} />}
			</div>
		);
	}

	const count = (type: ResultType, outcome: "same" | "updated") =>
		filesUploadResult.filter((result) => result[`${type}Result`] === outcome).length;

	return (
		<div className="confluence-results">
			<p>{filesUploadResult.length} file(s) published successfully.</p>

			{failedFiles.length > 0 && (
				<div className="confluence-failed">
					<p>{failedFiles.length} file(s) failed to publish:</p>
					<FailedList files={failedFiles} />
				</div>
			)}

			<table className="confluence-results-table">
				<thead>
					<tr>
						<th>Type</th>
						<th>Unchanged</th>
						<th>Updated</th>
					</tr>
				</thead>
				<tbody>
					{RESULT_TYPES.map(({ type, label }) => (
						<tr key={type}>
							<td>{label}</td>
							<td>{count(type, "same")}</td>
							<td>{count(type, "updated")}</td>
						</tr>
					))}
				</tbody>
			</table>

			<button type="button" onClick={() => setExpanded(!expanded)}>
				{expanded ? "Hide updated files" : "Show updated files"}
			</button>
			{expanded && (
				<div className="confluence-updated-files">
					{RESULT_TYPES.map(({ type, label }) => (
						<div key={type}>
							<h4>Updated {label.toLowerCase()}</h4>
							<UpdatedFiles results={filesUploadResult} type={type} />
						</div>
					))}
				</div>
			)}
		</div>
	);
};

export class CompletedModal extends Modal {
	private readonly props: UploadResultsProps;
	private root: Root | null = null;

	constructor(app: App, props: UploadResultsProps) {
		super(app);
		this.props = props;
	}

	override onOpen() {
		this.setTitle(this.props.uploadResults.errorMessage ? "Publish failed" : "Publish finished");
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<CompletedView {...this.props} />
			</StrictMode>,
		);
	}

	override onClose() {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}
