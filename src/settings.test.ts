import { expect, test } from "@effect/vitest";
import type { SecretStorage } from "obsidian";
import {
	describeSettingsIssue,
	mergeSettings,
	migrateSecretsToStorage,
	toPersistedSettings,
	withResolvedSecrets,
	withSiteUrlFallback,
} from "./settings";

function fakeStorage(initial: Record<string, string> = {}) {
	const secrets = new Map(Object.entries(initial));
	const storage = {
		getSecret: (id: string) => secrets.get(id) ?? null,
		setSecret: (id: string, value: string) => void secrets.set(id, value),
		listSecrets: () => [...secrets.keys()],
	} as SecretStorage;
	return { storage, secrets };
}

test("moves a plaintext API token into secret storage", () => {
	const { storage, secrets } = fakeStorage();
	const settings = mergeSettings({ atlassianApiToken: "token-value" });

	expect(migrateSecretsToStorage(settings, storage)).toBe(true);
	expect(settings.atlassianApiToken).toBe("");
	expect(settings.apiTokenSecretName).toBe("confluence-api-token");
	expect(secrets.get("confluence-api-token")).toBe("token-value");
});

test("moves a plaintext service-account client secret into secret storage", () => {
	const { storage, secrets } = fakeStorage();
	const settings = mergeSettings({ atlassianClientSecret: "client-secret" });

	expect(migrateSecretsToStorage(settings, storage)).toBe(true);
	expect(settings.atlassianClientSecret).toBe("");
	expect(secrets.get(settings.clientSecretSecretName)).toBe("client-secret");
});

test("does not overwrite an unrelated secret with the same name", () => {
	const { storage, secrets } = fakeStorage({ "confluence-api-token": "other" });
	const settings = mergeSettings({ atlassianApiToken: "token-value" });

	migrateSecretsToStorage(settings, storage);
	expect(settings.apiTokenSecretName).toBe("confluence-api-token-2");
	expect(secrets.get("confluence-api-token")).toBe("other");
	expect(secrets.get("confluence-api-token-2")).toBe("token-value");
});

test("keeps an existing stored secret and drops the stale plaintext copy", () => {
	const { storage, secrets } = fakeStorage({ mine: "current" });
	const settings = mergeSettings({ atlassianApiToken: "stale", apiTokenSecretName: "mine" });

	expect(migrateSecretsToStorage(settings, storage)).toBe(true);
	expect(secrets.get("mine")).toBe("current");
	expect(settings.atlassianApiToken).toBe("");
});

test("reports no change when nothing is stored in plaintext", () => {
	const { storage } = fakeStorage();
	expect(migrateSecretsToStorage(mergeSettings({}), storage)).toBe(false);
});

test("resolves credentials from storage without mutating settings", () => {
	const { storage } = fakeStorage({ token: "t", client: "c" });
	const settings = mergeSettings({ apiTokenSecretName: "token", clientSecretSecretName: "client" });

	const resolved = withResolvedSecrets(settings, storage);
	expect(resolved.atlassianApiToken).toBe("t");
	expect(resolved.atlassianClientSecret).toBe("c");
	expect(settings.atlassianApiToken).toBe("");
});

test("never persists credential values", () => {
	const settings = mergeSettings({});
	settings.atlassianApiToken = "leaked";
	settings.atlassianClientSecret = "leaked";

	const persisted = toPersistedSettings(settings);
	expect(persisted.atlassianApiToken).toBe("");
	expect(persisted.atlassianClientSecret).toBe("");
});

test("keeps nested defaults and rejects unknown Mermaid themes from older data", () => {
	const settings = mergeSettings({ plantuml: { enabled: true }, mermaidTheme: "neon" });
	expect(settings.plantuml).toEqual({ enabled: true, serverUrl: expect.any(String) });
	expect(settings.kroki?.serverUrl).toEqual(expect.any(String));
	expect(settings.mermaidTheme).toBe("match-obsidian");
});

test("ignores malformed plugin data", () => {
	expect(mergeSettings(null).mermaidTheme).toBe("match-obsidian");
	expect(mergeSettings(["unexpected"]).showPublishResultsModal).toBe(true);
});

test("uses the site URL as the API URL when it's left empty for token authentication", () => {
	const settings = mergeSettings({ confluenceSiteUrl: " https://example.atlassian.net " });
	expect(withSiteUrlFallback(settings).confluenceBaseUrl).toBe("https://example.atlassian.net");
	const explicit = mergeSettings({
		confluenceSiteUrl: "https://example.atlassian.net",
		confluenceBaseUrl: "https://api.atlassian.com/ex/confluence/abc",
	});
	expect(withSiteUrlFallback(explicit).confluenceBaseUrl).toBe(
		"https://api.atlassian.com/ex/confluence/abc",
	);
});

test("never uses the site URL as the API URL for OAuth", () => {
	const settings = mergeSettings({
		confluenceAuthType: "oauth2",
		confluenceSiteUrl: "https://example.atlassian.net",
	});
	expect(withSiteUrlFallback(settings).confluenceBaseUrl).toBe("");
});

test("words validation issues with the setting names shown in the settings tab", () => {
	expect(
		describeSettingsIssue({
			field: "confluenceBaseUrl",
			message: "Confluence base URL is required",
		}),
	).toBe("Confluence API URL is required.");
	expect(describeSettingsIssue({ field: "confluenceBaseUrl", message: "Must use HTTPS" })).toBe(
		"Confluence API URL: Must use HTTPS",
	);
	expect(describeSettingsIssue({ field: "forceOverwrite", message: "Other" })).toBe("Other");
});
