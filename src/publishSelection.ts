import { shouldPublishMarkdownFile, type ConfluenceUploadSettings } from "@markdown-confluence/lib";
import { PUBLISH_KEY } from "./frontmatterKeys";

/*
 * Rules for turning publishing on or off for one note. Which notes are published is decided
 * by the lib's `shouldPublishMarkdownFile`, so folders, tags and exclusions behave exactly as
 * they do in the publisher.
 */

type Frontmatter = Record<string, unknown> | undefined;
type Settings = ConfluenceUploadSettings.ConfluenceSettings;

/** Excluded folders override `connie-publish: true`, so enabling there would have no effect. */
export function isExcluded(path: string, settings: Settings): boolean {
	return !shouldPublishMarkdownFile(path, { [PUBLISH_KEY]: true }, settings);
}

/**
 * The `connie-publish` value that makes a note published or not, or undefined when the
 * folder and tag rules already do that and the flag should be removed.
 */
export function publishFlagFor(
	path: string,
	frontmatter: Frontmatter,
	settings: Settings,
	publish: boolean,
): boolean | undefined {
	const withoutFlag: Record<string, unknown> = { ...frontmatter };
	delete withoutFlag[PUBLISH_KEY];
	const publishedByDefault = shouldPublishMarkdownFile(path, withoutFlag, settings);
	return publish === publishedByDefault ? undefined : publish;
}
