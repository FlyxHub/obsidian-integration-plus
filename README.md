# Confluence Integration for Obsidian

Copyright © 2022 Atlassian Pty Ltd
Copyright © 2022 Atlassian US, Inc

Publish notes from your Obsidian vault to [Atlassian Confluence](https://www.atlassian.com/software/confluence) Cloud. Notes are converted to the [Atlassian Document Format (ADF)](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) by the [`@markdown-confluence/lib`](https://www.npmjs.com/package/@markdown-confluence/lib) library from the [markdown-confluence](https://github.com/markdown-confluence/markdown-confluence) project. This repository contains the Obsidian plugin only.

The plugin is desktop only and requires Obsidian 1.11.4 or later.

## Disclosures

- **Account required.** Publishing requires an Atlassian Cloud account with access to a Confluence site.
- **Network use.** The plugin sends note content, attachments, labels and page metadata to the Confluence site you configure, over HTTPS. It contacts Atlassian (`auth.atlassian.com`, `api.atlassian.com`) only for OAuth sign-in and token refresh. If you turn on Kroki or PlantUML rendering, diagram source is sent to the server you configure. The plugin has no telemetry.
- **Local network listener.** Browser OAuth sign-in starts a temporary HTTP listener on `127.0.0.1` at the callback port you configure. It accepts one matching login response and stops after sign-in, cancellation or five minutes.
- **Files outside your notes.** To match your Obsidian theme, Mermaid rendering reads the active theme and enabled CSS snippets from the vault's config folder. No files outside the vault are read.
- **Credentials.** API tokens, client secrets and OAuth tokens are kept in Obsidian's secret storage, not in the plugin's `data.json`. Earlier versions stored the API token and service-account client secret in `data.json`; they are moved into secret storage the first time this version loads.

## Installation

Download `main.js`, `manifest.json` and `styles.css` from the releases page. Create `.obsidian/plugins/confluence-integration` inside your vault, put the three files there, restart Obsidian, and turn on **Confluence Integration** under **Settings → Community plugins**.

## Setup

In the plugin settings:

1. Choose an **Authentication type**:
   - **API token (basic)**: your Atlassian email and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
   - **Bearer token or PAT**: a bearer token.
   - **OAuth service account**: a client ID and secret from Atlassian Administration.
   - **OAuth browser sign-in**: sign in through your browser with an OAuth app you registered with Atlassian.
2. Enter the **Confluence API URL** (for example `https://example.atlassian.net`, or `https://api.atlassian.com/ex/confluence/{cloudId}` for scoped API tokens) and the **Confluence site URL**.
3. For the API token or client secret, choose or create a secret in Obsidian's secret storage.
4. Enter the **Parent page ID**: the Confluence page that published notes are created under.
5. Set the **Folder to publish**, and optionally **Tags to publish** and **Excluded folders**.

Settings that need attention are listed at the top of the settings tab.

## Usage

- Click the cloud icon in the ribbon, or run **Publish all notes**, to publish every selected note.
- Run **Publish current note** to publish only the active note.
- Click the status bar item, or run **Cancel publishing after the current request**, to stop a publish. Completed writes are kept.
- Run **Enable publishing for current note** or **Disable publishing for current note** to include or exclude a note outside the usual folder and tag rules.
- Run **Edit page settings for current note** to edit the note's Confluence frontmatter, such as its title, labels and content type.

### Choosing which notes are published

A note is published when it is inside **Folder to publish**, has one of the **Tags to publish**, or has `connie-publish: true` in its frontmatter. `connie-publish: false` always excludes a note, and **Excluded folders** override everything else.

```yaml
---
connie-publish: true
---
```

After publishing, the plugin writes `connie-page-id` and `connie-page-url` to the note's frontmatter. To manage an existing Confluence page from Obsidian, create a note and set its `connie-page-id`.

By default, publishing does not overwrite a page that another user edited last. Turn on **Overwrite other users' edits** only after checking the conflict.

### Page hierarchy

The parent page is the root of the published tree. Folders become pages. A folder note named after the folder, or `index.md`, `README.md` or `readme.md`, supplies that folder page's content.

### Embeds, diagrams and equations

- Note embeds such as `![[Shared Notes/Release Checklist]]` are expanded before publishing.
- Mermaid diagrams and LaTeX equations are rendered on your computer.
- Kroki (`kroki-*` code blocks) and PlantUML (`plantuml`, `puml`, `uml` code blocks) are off by default. Turning them on sends diagram source to the server you configure, so use one you trust, such as a self-hosted instance.
- Dataview `TABLE`, `LIST` and `TASK` queries can be published as their results when **Publish Dataview results** is on and Dataview is installed.

## Development

Requires Node.js 24.15 or later.

```bash
npm install
npm run dev        # watch build; writes main.js in this folder
npm run build      # type-check and production build
npm test           # unit tests (Vitest)
npm run lint       # ESLint with eslint-plugin-obsidianmd
```

Clone the repository into `<vault>/.obsidian/plugins/confluence-integration`, run `npm run dev`, and reload the plugin in Obsidian after each build.

## Issues

Report conversion and publishing problems to [markdown-confluence/markdown-confluence](https://github.com/markdown-confluence/markdown-confluence/issues), where the shared library is developed.

## License

Licensed under the [Apache 2.0](LICENSE) License.

The Apache license applies only to this Obsidian Confluence Integration ("Integration"), not to any third party's services, websites, content or platforms that the Integration lets you connect to. No license is granted to you by the licensors above to access any third-party service, website, content or platform. You are solely responsible for obtaining licenses from those third parties and complying with their terms. Do not disclose any passwords, credentials or tokens to a third-party service in your contributions to this project.
