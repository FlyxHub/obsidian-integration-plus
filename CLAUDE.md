# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Obsidian plugin ("Confluence Integration", manifest id `confluence-integration`) that publishes vault notes to Confluence Cloud as Atlassian Document Format (ADF). The source is ported from the upstream `markdown-confluence/markdown-confluence` monorepo (`packages/obsidian` at release 7.0.0, commit `d40afb8`) and rebuilt here as a standalone npm project. Upstream CI release commits (`Release X from <sha>`) touch only `manifest.json`, `versions.json` and `README.md`; when pulling upstream changes into `src/`, diff against that package, not this repo's history.

The working copy sits inside a test vault (`Plugin Testing/.obsidian/plugins/obsidian-integration-plus`), so Obsidian loads `main.js` straight from this folder.

## Commands

```bash
npm install
npm run dev          # esbuild watch -> ./main.js (inline sourcemaps); reload the plugin in Obsidian after each build
npm run build        # tsc --noEmit + minified production ./main.js
npm test             # Vitest, all src/**/*.test.ts
npx vitest run src/settings.test.ts          # one file
npx vitest run -t "moves a plaintext API"    # one test by name
npm run lint         # ESLint with eslint-plugin-obsidianmd over src and package.json
npm run fmt          # Prettier (tabs, width 100)
```

- Node 24.15+. `main.js` is gitignored; ship it only in releases, with `manifest.json` and `styles.css`.
- `effect` and `@effect/vitest` are pinned to `4.0.0-rc.112` to match the lib, and `overrides` pins `@effect/platform-node-shared` to the same version. A mismatched Effect prerelease fails at runtime with "Cannot find module effect/dist/...". Upgrade all of them together with `@markdown-confluence/*`.
- `npm version <x>` runs `version-bump.mjs`, which copies the version into `manifest.json` and records it in `versions.json` with the current `minAppVersion`.
- Test files can't import runtime values from `obsidian` (the package ships only types), so keep testable logic in modules that import `obsidian` as `import type` (see `settings.ts`).

## Git workflow

After making changes, commit them and push to `origin` without waiting to be asked. Run `npm run typecheck`, `npm run lint` and `npm test` first, and say so if any fail. Work on a feature branch rather than `main`; push new branches with `git push -u origin <branch>`.

## Documentation

Write user-facing docs, such as `README.md`, in the style of the [Google developer documentation style guide](https://developers.google.com/style): second person, present tense, active voice, sentence-case headings, serial commas, numbered steps for procedures, and `PLACEHOLDER` names that the text explains. The README includes the testing and release guides; update them when scripts, the release process, or anything in the Disclosures section changes.

## Architecture

Conversion, page-tree planning and Confluence API calls all live in `@markdown-confluence/lib`, which is built on Effect. The plugin supplies Obsidian implementations of the lib's services and the UI:

- `src/main.ts`: `ConfluencePlugin`. `onload` only loads settings and registers things. Each publish builds a fresh client and `Publisher` (`createPublisher`), so OAuth tokens and theme CSS are never cached. It then runs `publisher.publishEffect` through `runObsidianEffect`, which provides `MarkdownWorkspaceLive`, the Dataview source transformer, the settings layer and `ObsidianPlatformLive`. Enable/disable publishing reuses the lib's `shouldPublishMarkdownFile`, so the folder/tag/exclusion rules exist in one place. Frontmatter edits go through `fileManager.processFrontMatter`.
- `src/settings.ts`: settings type, defaults and `mergeSettings`. **Credentials never live in `data.json`.** The settings store only secret *names* (`apiTokenSecretName`, `clientSecretSecretName`). `withResolvedSecrets` fills in `atlassianApiToken`/`atlassianClientSecret` from `app.secretStorage` just before authenticating, and `toPersistedSettings` blanks them on every save. `migrateSecretsToStorage` moves plaintext values left by older versions on load. Use `plugin.resolvedSettings()` wherever credentials are needed, and never persist its result.
- `src/effects/ObsidianPlatform.ts`: implements Effect's `FileSystem`/`Path` services on top of the Vault API, so the lib reads notes and attachments, and writes `connie-page-id`/`connie-page-url`, through Obsidian.
- `src/ObsidianAuthentication.ts` + `src/desktopFetch.ts`: authenticated Confluence client. `desktopFetch` uses Node `https` to avoid CORS, rejects non-HTTPS URLs and refuses redirects so credentials can't be forwarded.
- `src/BrowserOAuth.ts`, `src/AtlassianOAuth.ts`, `src/OAuthCallback.ts`: OAuth sign-in (authorization code with PKCE, or device code) and token refresh, with tokens in SecretStorage. `OAuthCallback` runs a short-lived, hardened HTTP listener on 127.0.0.1. Treat changes here as security-sensitive and keep the tests passing.
- `src/KrokiFetch.ts`, `src/DataviewTransformer.ts`: optional Kroki transport, and publishing Dataview query results through Dataview's public API.
- `src/ConfluenceSettingTab.ts`, `src/CompletedModal.tsx`, `src/ConfluencePerPageForm.tsx`: UI. The modals mount React 19 with `createRoot` and unmount in `onClose`. The per-page form is generated from the lib's `ConfluencePageConfig.conniePerPageConfig`. Styles live in `styles.css` and use Obsidian CSS variables.

## Obsidian plugin rules

All new and changed code must follow these rules. They come from Obsidian's Plugin guidelines, Submission requirements, Developer policies, the plugin self-critique checklist, and the lifecycle, load-time, React and SecretStorage guides. WebFetch on docs.obsidian.md often returns "Not Found". To re-check a rule, fetch the source markdown from `https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/<path>.md`, for example `Plugins/Releasing/Plugin guidelines` or `Community directory/Developer policies` (URL-encode spaces). Check the `@since` tags in `obsidian.d.ts` before using an API, and raise `minAppVersion` in `manifest.json` when you depend on something newer.

### API usage
- Use `this.app`. Never use the global `app` or `window.app`.
- Workspace: use `workspace.getActiveViewOfType(MarkdownView)` or `workspace.activeEditor?.editor`. Never use `workspace.activeLeaf`.
- Frontmatter: always write it with `app.fileManager.processFrontMatter`. Never parse or rewrite YAML by hand.
- File edits: to change the active note, use the `Editor`. For background edits, use `vault.process`. Never use `vault.modify`. To delete, use `fileManager.trashFile`, not `vault.delete`.
- Prefer the Vault API (`vault.read`/`cachedRead`/`readBinary`) over `vault.adapter`. The adapter is acceptable only for paths the vault doesn't index, such as the config directory.
- Never hardcode `.obsidian`. Use `this.app.vault.configDir`.
- Look files up with `vault.getFileByPath`, `getFolderByPath` or `getAbstractFileByPath`. Don't loop over `getFiles()` to find one path.
- Pass every user-supplied or constructed vault path through `normalizePath()`. When comparing folder prefixes, compare against `folder + "/"` so that `Docs` doesn't match `Docs-archive`.
- Check with `instanceof` (`TFile`, `TFolder`, `FileSystemAdapter`) before narrowing a type. Don't use `as any`.
- Plugin data is stored only through `loadData()`/`saveData()`, and always via `toPersistedSettings`.
- Network calls go through Obsidian's `requestUrl` (as `MyBaseClient` already does), never `fetch` or axios.
- If you need `moment`, import it from `obsidian`.

### Secrets
- Credential settings must use `SecretStorage` and `SecretComponent`, added with `Setting.addComponent`. The setting stores only the secret's *name*; read the value with `this.app.secretStorage.getSecret(name)`, which can return `null`. See `settings.ts`.
- Never log credentials, request headers or whole request objects.

### Lifecycle and performance
- `onload` should only register things: commands, the settings tab, the ribbon icon, events. Put expensive or I/O work (reading theme CSS, `loadMermaid()`, building clients) in `workspace.onLayoutReady()`, or better, do it lazily when a publish starts.
- Register vault events such as `vault.on('create')` inside `onLayoutReady`, because Obsidian fires `create` for every file during startup.
- Register every listener and timer through `registerEvent`, `registerDomEvent` or `registerInterval`, or clean it up yourself in `onunload`. Don't detach leaves in `onunload`.
- Custom views: register with `() => new View()` and don't keep a reference to the view. Find open views with `getLeavesOfType`, and support deferred views.
- Release builds must be production builds and minified. `esbuild.config.mjs` already minifies.

### Commands
- Choose the callback type by when the command can run: `callback` (always), `checkCallback` (only under conditions; return `false` while `checking` if it can't run), `editorCallback`/`editorCheckCallback` (needs an active Markdown editor).
- Don't set default hotkeys. Don't put the plugin ID in command IDs or the plugin name in command names; Obsidian adds both.
- Command names use sentence case.

### UI
- Use sentence case for all UI text: setting names, descriptions, command names, buttons, notices.
- The settings tab has no top-level heading (no `h2` with the plugin name). Add section headings only when there is more than one section, create them with `new Setting(el).setName(...).setHeading()`, and don't put "settings" or "options" in them.
- Never use `innerHTML`, `outerHTML` or `insertAdjacentHTML`. Build elements with `createEl`, `createDiv` and `createSpan`, and clear them with `el.empty()`.
- No styling from JS or inline `style=`. Use CSS classes in a `styles.css` file built from Obsidian CSS variables (`var(--text-normal)`, `var(--background-modifier-error)`, and so on), and don't override core Obsidian classes.
- React: mount with `createRoot(el)` from `react-dom/client` and call `root.unmount()` in `onClose`. Don't use the legacy `ReactDOM.render` or `unmountComponentAtNode`. Pass `App` in through a React context, not the global.

### Code style
- Use `const`/`let` (never `var`) and `async`/`await` instead of `.then()` chains. Don't add module-level mutable globals.
- Log only errors. Remove debug `console.log`s before committing.
- Split large files into modules or folders.
- Formatting is Prettier with tabs. Every `eslint-disable` needs a `-- reason` description (enforced). The upstream project uses Conventional Commits.

### Manifest, repo and policy
- `isDesktopOnly: true` must stay because the plugin uses Electron for Mermaid rendering. If mobile support is ever the goal, load Node/Electron modules behind `Platform.isDesktopApp` with a runtime `require`, use `Platform` instead of `process.platform`, and avoid regex lookbehind.
- Set `minAppVersion` to the oldest Obsidian version the APIs in use actually support.
- `description`: at most 250 characters, begins with a verb ("Publish notes to…", not "This plugin allows…"), ends with a period, no emoji, correct capitalization (Obsidian, Markdown, Confluence).
- Keep `fundingUrl` only if donations are accepted. Keep the LICENSE file (Apache 2.0) and credit the original authors, since this is a fork.
- Don't commit `main.js`; it belongs only on releases. Commit `package-lock.json`.
- Policy: no client-side telemetry, no obfuscation, no self-updating, and keep dependencies to a minimum. Keep the README's Disclosures section accurate whenever network use, the local OAuth listener, or files read outside notes change.

### Known deviations in the current code
These are deliberate; keep them unless the reason no longer applies.
- `main.ts` `readConfigCss` uses `vault.adapter`, because the Vault API doesn't index the config directory. Path segments come from app config and are checked before joining.
- `getVaultConfig` uses the undocumented `vault.getConfig` to find the active theme and snippets, behind a typed optional accessor.
- `ObsidianPlatform.writeFileString` replaces whole files with `vault.process`, because the lib computes the new content. It is not a read-modify-write inside `process`.
- `eslint.config.mjs` turns off `no-nodejs-modules` (desktop-only), `prefer-setting-definitions` (needs 1.13), and `prefer-window-timers` for the Node-side OAuth modules. It also relaxes the `no-unsafe-*` rules in tests.
- `ConfluenceSettingTab` renders imperatively with `display()`. When `minAppVersion` reaches 1.13.0, migrate to `getSettingDefinitions()`.
