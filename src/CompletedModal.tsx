import { Modal, App } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { StrictMode, useState } from "react";
import { UploadAdfFileResult } from "@markdown-confluence/lib";

export interface FailedFile {
	fileName: string;
	reason: string;
}

export interface UploadResults {
	errorMessage: string | null;
	failedFiles: FailedFile[];
	filesUploadResult: UploadAdfFileResult[];
}

export interface UploadResultsProps {
	uploadResults: UploadResults;
}

/** Page URLs come from the Confluence API; only link to web pages. */
function safePageUrl(url: string | undefined): string | undefined {
	if (!url || !URL.canParse(url)) return undefined;
	return new URL(url).protocol === "https:" ? url : undefined;
}

const UpdatedFiles = ({
	results,
	type,
}: {
	results: UploadAdfFileResult[];
	type: "content" | "image" | "label";
}) => (
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
			</div>
		);
	}

	const countResults = {
		content: { same: 0, updated: 0 },
		images: { same: 0, updated: 0 },
		labels: { same: 0, updated: 0 },
	};
	for (const result of filesUploadResult) {
		countResults.content[result.contentResult]++;
		countResults.images[result.imageResult]++;
		countResults.labels[result.labelResult]++;
	}

	return (
		<div className="confluence-results">
			<p>{filesUploadResult.length} file(s) published successfully.</p>

			{failedFiles.length > 0 && (
				<div className="confluence-failed">
					<p>{failedFiles.length} file(s) failed to publish:</p>
					<ul>
						{failedFiles.map((file) => (
							<li key={file.fileName}>
								<strong>{file.fileName}</strong>: {file.reason}
							</li>
						))}
					</ul>
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
					<tr>
						<td>Content</td>
						<td>{countResults.content.same}</td>
						<td>{countResults.content.updated}</td>
					</tr>
					<tr>
						<td>Images</td>
						<td>{countResults.images.same}</td>
						<td>{countResults.images.updated}</td>
					</tr>
					<tr>
						<td>Labels</td>
						<td>{countResults.labels.same}</td>
						<td>{countResults.labels.updated}</td>
					</tr>
				</tbody>
			</table>

			<button type="button" onClick={() => setExpanded(!expanded)}>
				{expanded ? "Hide updated files" : "Show updated files"}
			</button>
			{expanded && (
				<div className="confluence-updated-files">
					<h4>Updated content</h4>
					<UpdatedFiles results={filesUploadResult} type="content" />
					<h4>Updated images</h4>
					<UpdatedFiles results={filesUploadResult} type="image" />
					<h4>Updated labels</h4>
					<UpdatedFiles results={filesUploadResult} type="label" />
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
