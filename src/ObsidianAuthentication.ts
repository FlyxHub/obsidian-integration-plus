import {
	createAuthenticatedConfluenceClient,
	validateConfluenceSettings,
	type ConfluenceFetch,
	type ConfluenceUploadSettings,
} from "@markdown-confluence/lib";
import { Effect } from "effect";
import { desktopFetch } from "./desktopFetch";
import { describeSettingsIssue, withBearerToken } from "./settings";

/** Construct per publish so a vault left open never keeps an expired OAuth token. */
export async function createObsidianConfluenceClient(
	settings: ConfluenceUploadSettings.ConfluenceSettings,
	oauthAccessToken?: string,
	fetch: ConfluenceFetch = desktopFetch,
) {
	const validation = validateConfluenceSettings(
		oauthAccessToken ? withBearerToken(settings, oauthAccessToken) : settings,
	);
	if (!validation.valid) throw new Error(validation.issues.map(describeSettingsIssue).join("\n"));
	return Effect.runPromise(
		createAuthenticatedConfluenceClient(settings, {
			fetch,
			...(oauthAccessToken ? { oauthAccessToken } : {}),
		}),
	);
}
