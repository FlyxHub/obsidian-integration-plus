import { Notice } from "obsidian";
import { errorMessage } from "./errors";
import type ConfluencePlugin from "./main";
import { contentRow, type SettingRow } from "./settingRows";

/**
 * The settings for OAuth browser sign-in: the app registration, the connection itself, and
 * the site to publish to. `redisplay` renders the whole tab again after a state change.
 */
export function browserLoginRows(plugin: ConfluencePlugin, redisplay: () => void): SettingRow[] {
	const rows = [...appRegistrationRows(plugin, redisplay), ...connectionRows(plugin, redisplay)];
	if (!plugin.browserOAuth.connected || plugin.browserOAuth.pending) return rows;
	return [
		...rows,
		...siteChoiceRows(plugin, redisplay),
		contentRow("Saved login", "confluence-settings-note", (el) => {
			el.createEl("p", {
				cls: "setting-item-description",
				text: "Tokens are kept in Obsidian secret storage. Disconnect removes this vault's saved login. You can revoke the app under connected apps in your Atlassian account.",
			});
		}),
	];
}

/** Login method, client ID, client secret and callback URL; locked while signed in. */
function appRegistrationRows(plugin: ConfluencePlugin, redisplay: () => void): SettingRow[] {
	const { settings, browserOAuth: auth } = plugin;
	const disabled = auth.pending || auth.connected;

	const rows: SettingRow[] = [
		{
			name: "Login method",
			desc: "Login runs inside this plugin. Device code login requires Atlassian to enable the grant for your app.",
			render: (setting) =>
				setting.addDropdown((dropdown) =>
					dropdown
						.addOptions({ "authorization-code": "Browser login", device: "Device code" })
						.setValue(settings.oauthFlow)
						.setDisabled(disabled)
						.onChange(async (value) => {
							if (value !== "authorization-code" && value !== "device") return;
							settings.oauthFlow = value;
							auth.status = "";
							await plugin.saveSettings();
							redisplay();
						}),
				),
		},
		{
			name: "OAuth client ID",
			desc: "The app registered with Atlassian for this integration.",
			render: (setting) =>
				setting.addText((text) =>
					text
						.setValue(settings.oauthClientId)
						.setDisabled(disabled)
						.onChange(async (value) => {
							settings.oauthClientId = value.trim();
							auth.status = "";
							await plugin.saveSettings();
						}),
				),
		},
		{
			name: "OAuth client secret",
			desc: "Saved in Obsidian secret storage. Standard Atlassian browser apps require it; leave it empty only for an approved public client.",
			render: (setting) =>
				setting
					.addText((text) => {
						text.inputEl.type = "password";
						text
							.setPlaceholder(
								auth.hasClientSecret ? "Secret saved" : "Enter app secret if required",
							)
							.setDisabled(disabled)
							.onChange(async (value) => {
								try {
									await auth.saveClientSecret(value);
								} catch (error) {
									new Notice(errorMessage(error));
								}
							});
					})
					.addButton((button) =>
						button
							.setButtonText("Clear secret")
							.setDisabled(disabled || !auth.hasClientSecret)
							.onClick(async () => {
								await auth.saveClientSecret("");
								redisplay();
							}),
					),
		},
	];
	if (settings.oauthFlow === "authorization-code")
		rows.push({
			name: "Callback URL",
			desc: "Register this exact URL with Atlassian. Obsidian listens on this computer only while you sign in.",
			render: (setting) =>
				setting.addText((text) =>
					text
						.setValue(settings.oauthCallbackUrl)
						.setDisabled(disabled)
						.onChange(async (value) => {
							settings.oauthCallbackUrl = value.trim();
							await plugin.saveSettings();
						}),
				),
		});
	return rows;
}

/** The device code while one is pending, and the connect, cancel and disconnect buttons. */
function connectionRows(plugin: ConfluencePlugin, redisplay: () => void): SettingRow[] {
	const { settings, browserOAuth: auth } = plugin;
	const rows: SettingRow[] = [];
	const device = auth.deviceAuthorization;
	if (device) {
		rows.push({
			name: "Your device code",
			desc: device.userCode,
			render: (setting) =>
				setting.addButton((button) =>
					button.setButtonText("Copy code").onClick(async () => {
						if (auth.deviceAuthorization)
							await navigator.clipboard.writeText(auth.deviceAuthorization.userCode);
					}),
				),
		});
	}

	rows.push({
		name: "Atlassian connection",
		desc:
			auth.status ||
			(auth.connected
				? "Connected"
				: "Sign in to choose the Confluence site this vault can publish to."),
		render: (status) => {
			if (auth.pending) {
				status.addButton((button) =>
					button.setButtonText("Open browser").onClick(() => auth.openBrowser()),
				);
				status.addButton((button) =>
					button.setButtonText("Cancel login").onClick(() => auth.cancel()),
				);
				return;
			}
			status.addButton((button) =>
				button
					.setButtonText(auth.connected ? "Reconnect" : "Connect to Atlassian")
					.setCta()
					.onClick(async () => {
						try {
							await auth.connect(redisplay);
							await plugin.selectOAuthSite(settings.oauthSiteId);
							new Notice("Connected to Atlassian");
						} catch (error) {
							new Notice(errorMessage(error));
						}
						redisplay();
					}),
			);
			if (auth.connected)
				status.addButton((button) =>
					button.setButtonText("Disconnect").onClick(async () => {
						await auth.disconnect();
						redisplay();
					}),
				);
		},
	});
	return rows;
}

/** The site to publish to, from those approved during login, and a connection test. */
function siteChoiceRows(plugin: ConfluencePlugin, redisplay: () => void): SettingRow[] {
	const { settings, browserOAuth: auth } = plugin;
	return [
		{
			name: "Confluence site",
			desc: "Only sites you approved during login are available.",
			render: (setting) =>
				setting.addDropdown((dropdown) => {
					for (const site of settings.oauthSites)
						dropdown.addOption(site.id, new URL(site.url).hostname);
					dropdown.setValue(settings.oauthSiteId).onChange(async (value) => {
						await plugin.selectOAuthSite(value);
						redisplay();
					});
				}),
		},
		{
			name: "Test connection",
			desc: "Check access to the parent page without publishing.",
			render: (setting) =>
				setting.addButton((button) =>
					button.setButtonText("Test connection").onClick(async () => {
						button.setDisabled(true);
						try {
							const client = await plugin.authenticationClient();
							const page = await client.content.getContentById({
								id: settings.confluenceParentId,
							});
							auth.status = `Connected · Parent page: ${page.title}`;
						} catch {
							auth.status = "Could not access the parent page. Check its ID, site and permissions.";
						}
						new Notice(auth.status);
						redisplay();
					}),
				),
		},
	];
}
