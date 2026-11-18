import { randomUUID } from "node:crypto";
import type { SecretStorage } from "obsidian";
import {
	AtlassianOAuth,
	type DeviceAuthorization,
	type OAuthDependencies,
	type OAuthSite,
	type OAuthTokens,
} from "./AtlassianOAuth";
import { oauthCallbackUrl } from "./OAuthCallback";
import { oauthApiUrl } from "./settings";

export interface BrowserOAuthSettings {
	oauthMode: "service-account" | "browser";
	oauthFlow: "authorization-code" | "device";
	oauthClientId: string;
	oauthClientSecretId: string;
	oauthCallbackUrl: string;
	oauthSecretId: string;
	oauthSites: OAuthSite[];
	oauthSiteId: string;
	/** The publish destination, which `selectSite` keeps on the chosen site. */
	confluenceBaseUrl: string;
	confluenceSiteUrl: string;
}
interface StoredTokens extends OAuthTokens {
	configuration: string;
}

/**
 * A publish or pull uses the token it starts with, so one that would expire during a long
 * run is refreshed before the run instead.
 */
const REFRESH_AHEAD_MS = 10 * 60 * 1000;

/** Where a login started with `connect` is. Only the login that owns `controller` changes it. */
type Login =
	| { step: "idle" }
	/** Requesting a device code, or starting the callback listener. */
	| { step: "starting"; controller: AbortController }
	/**
	 * Waiting for the user to approve access at `url`, then exchanging the approval for tokens
	 * and saving them. `device` is the code to enter, for device login.
	 */
	| {
			step: "approving";
			controller: AbortController;
			url: string;
			device: DeviceAuthorization | undefined;
	  };

/** Owns desktop browser/device login and rotating credentials for one vault. */
export class BrowserOAuth {
	private login: Login = { step: "idle" };
	private refreshController: AbortController | undefined;
	private refreshing: Promise<string> | undefined;
	private generation = 0;
	private readonly client: AtlassianOAuth;
	/** The outcome of the last login, cancel, disconnect or connection test. */
	lastResult = "";
	constructor(
		private readonly settings: () => BrowserOAuthSettings,
		private readonly storage: () => Pick<SecretStorage, "getSecret" | "setSecret">,
		private readonly save: () => Promise<void>,
		private readonly openUrl: (url: string) => void,
		dependencies: OAuthDependencies = {},
	) {
		this.client = new AtlassianOAuth(dependencies);
	}
	get pending() {
		return this.login.step !== "idle";
	}
	get deviceAuthorization(): DeviceAuthorization | undefined {
		return this.login.step === "approving" ? this.login.device : undefined;
	}
	/** What the login is doing, or the last outcome while none runs. */
	get status(): string {
		switch (this.login.step) {
			case "idle":
				return this.lastResult;
			case "starting":
				return this.settings().oauthFlow === "device"
					? "Requesting a device code…"
					: "Opening Atlassian login…";
			case "approving":
				return this.login.device
					? "Enter the code in your browser and approve access…"
					: "Waiting for approval in your browser…";
		}
	}
	get connected() {
		try {
			return !!this.read();
		} catch {
			return false;
		}
	}
	get hasClientSecret() {
		return !!this.clientSecret();
	}
	private credentials() {
		return { clientId: this.settings().oauthClientId.trim(), clientSecret: this.clientSecret() };
	}

	private clientSecret() {
		const id = this.settings().oauthClientSecretId;
		return id ? this.storage().getSecret(id) || undefined : undefined;
	}
	async saveClientSecret(value: string) {
		if (this.pending || this.connected)
			throw new Error("Disconnect before changing OAuth app credentials.");
		if (!this.settings().oauthClientSecretId)
			this.settings().oauthClientSecretId = `confluence-oauth-client-${randomUUID()}`;
		this.storage().setSecret(this.settings().oauthClientSecretId, value.trim());
		await this.save();
	}
	private configuration() {
		const settings = this.settings();
		if (!settings.oauthClientId.trim())
			throw new Error("Enter the OAuth client ID before connecting.");
		if (!["authorization-code", "device"].includes(settings.oauthFlow))
			throw new Error("Choose a supported OAuth login method.");
		return JSON.stringify({
			client: settings.oauthClientId.trim(),
			secret: settings.oauthClientSecretId,
			flow: settings.oauthFlow,
			callback:
				settings.oauthFlow === "authorization-code"
					? oauthCallbackUrl(settings.oauthCallbackUrl).href
					: "",
		});
	}
	private read(): StoredTokens | undefined {
		const id = this.settings().oauthSecretId;
		const value = id && this.storage().getSecret(id);
		if (!value) return undefined;
		let parsed: StoredTokens;
		try {
			parsed = JSON.parse(value) as StoredTokens;
		} catch {
			throw new Error("Saved login is invalid. Reconnect to Atlassian.");
		}
		if (parsed.configuration !== this.configuration()) return undefined;
		if (
			typeof parsed.accessToken !== "string" ||
			!parsed.accessToken ||
			typeof parsed.refreshToken !== "string" ||
			!parsed.refreshToken ||
			!Number.isFinite(parsed.expiresAt)
		)
			throw new Error("Saved login is invalid. Reconnect to Atlassian.");
		return parsed;
	}
	private checkConnection(generation: number, configuration: string) {
		if (generation !== this.generation || configuration !== this.configuration())
			throw new Error("Connection changed. Please try again.");
	}
	private async store(tokens: OAuthTokens, configuration: string, generation: number) {
		if (!this.settings().oauthSecretId) {
			this.settings().oauthSecretId = `confluence-oauth-${randomUUID()}`;
			await this.save();
		}
		this.checkConnection(generation, configuration);
		this.storage().setSecret(
			this.settings().oauthSecretId,
			JSON.stringify({ ...tokens, configuration }),
		);
	}
	openBrowser() {
		if (this.login.step === "approving") this.openUrl(this.login.url);
	}
	/**
	 * Choose one of the sites approved during login and make it the publish destination, so
	 * the two can't disagree. The caller saves the settings.
	 */
	selectSite(id: string) {
		const settings = this.settings();
		const site = settings.oauthSites.find((item) => item.id === id);
		if (!site) throw new Error("Choose an authorized Confluence site.");
		settings.oauthSiteId = id;
		settings.confluenceBaseUrl = oauthApiUrl(site.id);
		settings.confluenceSiteUrl = site.url;
	}
	async connect(onChange: () => void = () => {}) {
		if (this.pending) return;
		const configuration = this.configuration();
		const credentials = this.credentials();
		this.cancel();
		const controller = new AbortController();
		this.login = { step: "starting", controller };
		const generation = this.generation;
		/** False once `cancel` ended this login; the outcome is then `cancel`'s or a later one. */
		const current = () => this.login.step !== "idle" && this.login.controller === controller;
		onChange();
		try {
			const showBrowser = (url: string, device?: DeviceAuthorization) => {
				if (controller.signal.aborted) throw new Error("Login cancelled");
				this.login = { step: "approving", controller, url, device };
				onChange();
				this.openBrowser();
			};
			const tokens =
				this.settings().oauthFlow === "device"
					? await this.client.device(credentials, controller.signal, (device) =>
							showBrowser(device.verificationUrl, device),
						)
					: await this.client.browser(
							credentials,
							this.settings().oauthCallbackUrl,
							controller.signal,
							(url) => showBrowser(url),
						);
			const sites = await this.client.sites(tokens.accessToken, controller.signal);
			this.checkConnection(generation, configuration);
			await this.store(tokens, configuration, generation);
			this.checkConnection(generation, configuration);
			this.settings().oauthSites = sites;
			this.selectSite(
				sites.find((site) => site.id === this.settings().oauthSiteId)?.id ?? sites[0]!.id,
			);
			await this.save();
			this.checkConnection(generation, configuration);
			this.lastResult = "Connected";
		} catch (error) {
			const message = controller.signal.aborted
				? "Login cancelled"
				: error instanceof Error
					? error.message
					: "Login failed. Please try again.";
			if (current()) this.lastResult = message;
			throw new Error(message);
		} finally {
			if (current()) this.login = { step: "idle" };
			onChange();
		}
	}
	/** Stop a pending login and any token refresh, and refuse tokens that arrive afterwards. */
	cancel() {
		this.generation++;
		if (this.login.step !== "idle") {
			this.login.controller.abort();
			this.login = { step: "idle" };
			this.lastResult = "Login cancelled";
		}
		this.refreshController?.abort();
		this.refreshing = undefined;
	}
	async disconnect() {
		this.cancel();
		const settings = this.settings();
		if (settings.oauthSecretId) this.storage().setSecret(settings.oauthSecretId, "");
		settings.oauthSites = [];
		settings.oauthSiteId = "";
		this.lastResult = "Disconnected";
		await this.save();
	}
	async accessToken(): Promise<string> {
		const stored = this.read();
		if (!stored) throw new Error("Connect to Atlassian in Confluence settings before publishing.");
		if (stored.expiresAt > Date.now() + REFRESH_AHEAD_MS) return stored.accessToken;
		if (this.refreshing) return this.refreshing;
		const generation = this.generation;
		const controller = new AbortController();
		this.refreshController = controller;
		const refreshing = (async () => {
			const tokens = await this.client.refresh(
				this.credentials(),
				stored.refreshToken,
				controller.signal,
			);
			await this.store(tokens, stored.configuration, generation);
			return tokens.accessToken;
		})();
		this.refreshing = refreshing;
		try {
			return await refreshing;
		} finally {
			if (this.refreshing === refreshing) this.refreshing = undefined;
			if (this.refreshController === controller) this.refreshController = undefined;
		}
	}
}
