# Confluence Integration Plus

Confluence Integration Plus publishes notes from your Obsidian vault to [Atlassian Confluence](https://www.atlassian.com/software/confluence) Cloud, and pulls changes that people make in Confluence back into your notes. The plugin converts each note to [Atlassian Document Format (ADF)](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) with the [`@markdown-confluence/lib`](https://www.npmjs.com/package/@markdown-confluence/lib) library, which the [markdown-confluence](https://github.com/markdown-confluence/markdown-confluence) project maintains. This repository contains only the Obsidian plugin.

The plugin runs on desktop only and requires Obsidian 1.11.4 or later.

## Contents

- [Disclosures](#disclosures)
- [Install the plugin](#install-the-plugin)
- [Connect to Confluence](#connect-to-confluence)
- [Publish notes](#publish-notes)
- [Choose which notes are published](#choose-which-notes-are-published)
- [Pull changes from Confluence](#pull-changes-from-confluence)
- [Diagrams, equations, and embeds](#diagrams-equations-and-embeds)
- [Set up a development environment](#set-up-a-development-environment)
- [Test the plugin](#test-the-plugin)
- [Release the plugin](#release-the-plugin)
- [Report issues](#report-issues)
- [Credits and license](#credits-and-license)

## Disclosures

Obsidian's developer policies require plugins to disclose the following behavior:

- **Account:** You need an Atlassian Cloud account with access to a Confluence site.
- **Network use:** The plugin sends note content, attachments, labels, and page metadata over HTTPS to the Confluence site that you configure. When you pull, it reads pages from that site and writes their content into your notes. It contacts `auth.atlassian.com` and `api.atlassian.com` only to sign in with OAuth and to refresh tokens. If you turn on Kroki or PlantUML rendering, the plugin sends diagram source to the server that you configure. The plugin doesn't collect telemetry.
- **Local network listener:** Browser OAuth sign-in starts a temporary HTTP listener on `127.0.0.1` at the callback port that you configure. The listener accepts one matching sign-in response, and then stops. It also stops when you cancel sign-in or after five minutes.
- **Files other than notes:** To match your Obsidian theme in Mermaid diagrams, the plugin reads the active theme and enabled CSS snippets from the vault's configuration folder. To support pulling, it saves a snapshot of each published page in a `sync` folder inside the plugin's folder. The first time it loads, if it has no settings yet, it reads the settings of the original Confluence Integration plugin, if that plugin is installed. The plugin doesn't read or write files outside the vault.
- **Credentials:** The plugin keeps API tokens, client secrets, and OAuth tokens in Obsidian secret storage, not in the plugin's `data.json` file. The original Confluence Integration plugin stored the API token and the service-account client secret in `data.json`. If this plugin finds those values, it moves them into secret storage and removes them from `data.json`.

## Install the plugin

1. From the [releases page](https://github.com/FlyxHub/obsidian-integration-plus/releases), download `main.js`, `manifest.json`, and `styles.css`.
1. In your vault, create the folder `.obsidian/plugins/confluence-integration-plus`.
1. Copy the three files into that folder.
1. Restart Obsidian.
1. In Obsidian, go to **Settings** > **Community plugins**, and then turn on **Confluence Integration Plus**.

If you used the original Confluence Integration plugin in this vault, this plugin imports its settings the first time it loads. Pages that the original plugin published stay linked to your notes through `connie-page-id`. To avoid publishing from both plugins, turn off the original plugin.

## Connect to Confluence

### Before you begin

- Find the ID of the Confluence page that you want to publish notes under. The ID is the number after `/pages/` in the page URL. For example, the ID in `https://example.atlassian.net/wiki/spaces/DOCS/pages/123456/Home` is `123456`.
- Get credentials for one of the supported authentication types:
  - **API token (basic):** your Atlassian email address and an [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens).
  - **Bearer token or PAT:** a bearer token.
  - **OAuth service account:** a client ID and client secret from Atlassian Administration.
  - **OAuth browser sign-in:** the client ID of an OAuth app that you registered with Atlassian.

### Configure the plugin

1. Go to **Settings** > **Confluence Integration Plus**.
1. In the **Authentication type** list, select your authentication type.
1. In **Confluence site URL**, enter the address that you open in a browser, such as `https://example.atlassian.net`.
1. Leave **Confluence API URL** empty, unless one of the following applies:
   - If you use a scoped API token or an OAuth service account, enter `https://api.atlassian.com/ex/confluence/CLOUD_ID`. Replace `CLOUD_ID` with your site's cloud ID.
   - If you sign in with OAuth in the browser, the plugin fills in this setting when you choose your site.
1. Enter your credentials. For the API token or client secret, select an existing secret or create one in Obsidian secret storage.
1. In **Parent page ID**, enter the page ID that you found earlier.
1. In **Folder to publish**, enter the vault folder that contains the notes to publish.

If a setting needs attention, the plugin lists it at the top of the settings tab.

## Publish notes

To publish notes, do any of the following:

- To publish every selected note, click **Publish to Confluence** (the cloud upload icon) in the ribbon, or run **Publish all notes** from the command palette.
- To publish only the active note, run **Publish current note**.
- To stop a publish or pull, click the status bar item or run **Cancel publish or pull after the current request**. The plugin keeps pages that it already wrote.

After a note is published, the plugin adds `connie-page-id` and `connie-page-url` to its frontmatter.

To manage an existing Confluence page from Obsidian, create a note and set its `connie-page-id` property to the page ID.

**Note:** The plugin doesn't publish over changes in Confluence that you haven't pulled. To bring those changes into your notes, see [Pull changes from Confluence](#pull-changes-from-confluence). To overwrite them instead, turn on **Overwrite other users' edits**; the other user's changes are lost.

## Choose which notes are published

The plugin publishes a note if any of the following are true:

- The note is inside **Folder to publish**.
- The note has a tag that's listed in **Tags to publish**.
- The note's frontmatter contains `connie-publish: true`.

Two rules take priority:

- A note with `connie-publish: false` is never published.
- A note inside a folder listed in **Excluded folders** is never published, even if it has `connie-publish: true`.

To include or exclude the active note, run **Enable publishing for current note** or **Disable publishing for current note**. To edit the note's Confluence properties, such as its title, labels, and content type, run **Edit page settings for current note**.

### Page hierarchy

The parent page is the root of the published tree, and each folder becomes a page. To give a folder page its own content, add a folder note named after the folder, or named `index.md`, `README.md`, or `readme.md`.

## Pull changes from Confluence

Pull brings edits that people make in Confluence into your notes, so you can work like you do with Git: pull, edit, and then publish.

Each time you publish or pull a page, the plugin saves a snapshot of the page as it is in Confluence. When you pull, the plugin compares the page with that snapshot to find what changed in Confluence, and then applies only those changes to your note. Changes that you made in Obsidian are kept, including Mermaid source, embeds, and links that look different in Confluence.

### Pull notes

To pull, do one of the following:

- To pull every note that's linked to a page, click **Pull from Confluence** (the cloud download icon) in the ribbon, or run **Pull all notes**.
- To pull only the active note, run **Pull current note**.

When the pull finishes, a dialog lists the notes that were updated, imported, or have conflicts. If a note has conflicts, the dialog opens even when **Show results after publishing** is off.

If a page's title changed in Confluence, the plugin sets the note's `connie-title` property to the new title. It doesn't rename the note file.

If a page was deleted in Confluence, the plugin reports it and keeps your note.

### Resolve conflicts

A conflict happens when a block changed both in Obsidian and in Confluence. The plugin keeps both versions in the note, between Git-style markers:

```text
<<<<<<< Obsidian
The text in your note.
=======
The text in Confluence.
>>>>>>> Confluence
```

To resolve a conflict:

1. Open the note, and find each block that starts with `<<<<<<< Obsidian`.
1. Edit the block so that it contains the text that you want to keep.
1. Delete the three marker lines.
1. Publish the note.

The plugin doesn't publish or pull a note that still contains conflict markers.

### How publishing uses pulled changes

Like `git push`, publishing stops if Confluence has changes that you haven't pulled:

- If a page changed in Confluence since your last publish or pull, nothing is published, and the results dialog lists the notes to pull first.
- After you pull a page that another user edited, you can publish over their edit, because it's already merged into your note.
- For a page that you haven't published or pulled since you installed this version, the plugin keeps the earlier rule: it doesn't overwrite a page that another user edited last, unless **Overwrite other users' edits** is on.

**Note:** Pages that you published before you installed this version have no snapshot yet. If you're the last person who edited the page, the first pull records a snapshot and doesn't change the note. If someone else edited it, the first pull can't tell which changes are whose, so it marks every difference as a conflict.

### Import new pages

When **Import new pages when pulling** is on, **Pull all notes** also creates notes for pages that were added under the parent page in Confluence:

- A page without child pages becomes a note in the folder that matches its parent page.
- A page with child pages becomes a folder with a folder note of the same name.
- A folder page that the plugin generated becomes a folder without a note.

The plugin adds `connie-page-id` to each imported note. If the page title contains characters that aren't allowed in file names, the plugin replaces them in the file name, and keeps the original title in `connie-title`.

The plugin skips a page, and says why in the results dialog, in these cases:

- A note already exists at the path where the page would be imported. The plugin doesn't overwrite it. To link that note to the page, add the page's `connie-page-id` to the note.
- The page's parent is a regular note, not a folder note. To import its child pages, move the parent note into a folder of the same name.

### Limitations

- Pull doesn't download attachments. Images and other attachments stay in Confluence, and the note refers to them in an `adf` code block, which is restored exactly when you publish.
- Content that Markdown can't represent, such as status lozenges and page layouts, appears as an `adf` code block. Edit these blocks in Confluence.
- For security, pulled code blocks that plugins run as JavaScript, such as `dataviewjs` and `js-engine`, become plain `text` code blocks, and Dataview inline JavaScript (`` `$= ...` ``) is disabled. This prevents anyone who can edit a Confluence page from running code in your vault. Code blocks that you wrote in Obsidian aren't changed.
- Pull applies changes line by line. If you and someone in Confluence edit the same paragraph, the whole paragraph is a conflict.

## Diagrams, equations, and embeds

- **Embeds:** The plugin expands note embeds, such as `![[Shared Notes/Release Checklist]]`, before publishing.
- **Mermaid and LaTeX:** The plugin renders Mermaid diagrams and LaTeX equations on your computer.
- **Kroki and PlantUML:** Kroki (`kroki-*` code blocks) and PlantUML (`plantuml`, `puml`, and `uml` code blocks) are off by default. When you turn them on, the plugin sends diagram source to the server that you configure. Use a server that you trust, such as a self-hosted instance.
- **Dataview:** If Dataview is installed and **Publish Dataview results** is on, the plugin publishes the results of Dataview `TABLE`, `LIST`, and `TASK` queries. DataviewJS and inline queries aren't supported.

## Set up a development environment

### Before you begin

Install the following:

- [Node.js](https://nodejs.org/) 24.15 or later.
- [Git](https://git-scm.com/).
- Obsidian 1.11.4 or later.

### Build the plugin

1. Create a vault for testing. Don't use a vault that contains notes you care about.
1. Clone this repository into the vault's plugin folder:

   ```bash
   git clone https://github.com/FlyxHub/obsidian-integration-plus.git \
     "VAULT_PATH/.obsidian/plugins/confluence-integration-plus"
   ```

   Replace `VAULT_PATH` with the path to your test vault.

1. Install dependencies:

   ```bash
   cd "VAULT_PATH/.obsidian/plugins/confluence-integration-plus"
   npm install
   ```

1. Start a watch build:

   ```bash
   npm run dev
   ```

   The build writes `main.js` to the plugin folder and rebuilds it when you save a source file.

1. In Obsidian, go to **Settings** > **Community plugins**, and then turn on **Confluence Integration Plus**.

To load a new build, turn the plugin off and on again under **Settings** > **Community plugins**. To reload it automatically on every build, install the [Hot-Reload](https://github.com/pjeby/hot-reload) plugin.

The following table describes the npm scripts:

| Command | Description |
| --- | --- |
| `npm run dev` | Builds `main.js` with inline source maps, and rebuilds on changes. |
| `npm run build` | Type-checks the code, and then builds a minified production `main.js`. |
| `npm run typecheck` | Type-checks the code without building. |
| `npm test` | Runs the unit tests with Vitest. |
| `npm run lint` | Lints `src/` and `package.json` with ESLint and `eslint-plugin-obsidianmd`. |
| `npm run fmt` | Formats the source with Prettier. |
| `npm run fmt:check` | Checks formatting without changing files. |

## Test the plugin

Run the automated checks before every commit, and test in Obsidian before every release.

### Run the automated checks

1. Run the type checker, linter, and unit tests:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   ```

1. Check formatting:

   ```bash
   npm run fmt:check
   ```

All four commands must finish without errors. The linter uses `eslint-plugin-obsidianmd`, which checks many of the rules that Obsidian applies when it reviews plugins.

To run one test file, pass its path. To run tests whose names match a pattern, use `-t`:

```bash
npx vitest run src/settings.test.ts
npx vitest run -t "moves a plaintext API token"
```

Unit tests run in Node.js, where the `obsidian` package provides only types. Code that you want to unit test must import from `obsidian` with `import type` only. For an example, see `src/settings.ts`.

### Test in Obsidian

#### Before you begin

- Set up a [development environment](#set-up-a-development-environment).
- Create a Confluence space or parent page that's only for testing. Publishing creates and changes real pages.

#### Test publishing

1. Run `npm run dev`, and then reload the plugin.
1. Open the developer console. On Windows and Linux, press `Ctrl+Shift+I`. On macOS, press `Cmd+Option+I`.
1. [Connect to Confluence](#connect-to-confluence), using your test page as the parent page.
1. In the folder to publish, create a note that contains a heading, an image, and a Mermaid diagram.
1. Run **Publish all notes**.
1. Verify the following:
   - The results dialog reports no failures.
   - The page in Confluence shows the heading, image, and diagram.
   - The note's frontmatter contains `connie-page-id` and `connie-page-url`.
   - The developer console shows no errors.
1. Edit the note, publish it again, and verify that the plugin updates the same Confluence page.
1. Start a publish of several notes, and then run **Cancel publish or pull after the current request**. Verify that the publish stops.

#### Test pulling

These steps need a second Confluence account, or a colleague, to act as the other editor.

1. Publish a note that contains a Mermaid diagram and at least three paragraphs.
1. Run **Pull all notes**. Verify that the dialog reports the note as unchanged.
1. As the other user, edit the last paragraph in Confluence.
1. In Obsidian, edit the first paragraph, and then run **Publish all notes**. Verify that nothing is published and the dialog says to pull the note first.
1. Run **Pull all notes**. Verify the following:
   - The dialog lists the note as updated.
   - The note contains your edit, the Confluence edit, and the Mermaid source.
1. Run **Publish all notes**, and verify that the page in Confluence shows both edits.
1. As the other user, edit the first paragraph in Confluence. In Obsidian, edit the same paragraph differently, and then pull. Verify that the note contains conflict markers, and that publishing is refused until you remove them.
1. As the other user, create a page under the parent page. Pull, and verify that a new note with its `connie-page-id` appears in the folder to publish.
1. As the other user, add a `dataviewjs` code block to a page. Pull, and verify that the block arrives as a `text` code block.

#### Test the credential migration

This test confirms that the plugin moves plaintext credentials from older versions into secret storage.

1. Turn off the plugin.
1. Open `data.json` in the plugin folder, and set `"atlassianApiToken"` to `"test-token"`.
1. Turn on the plugin. Verify that a notice says that credentials were moved to secret storage.
1. Open `data.json` again. Verify that `atlassianApiToken` is an empty string and that `apiTokenSecretName` contains a secret name.

#### Check startup time

1. Go to **Settings** > **General** > **Advanced**.
1. Click the stopwatch icon, and check how long **Confluence Integration Plus** takes to load.

The plugin loads settings and registers commands at startup. It shouldn't take noticeably longer than other plugins.

## Release the plugin

A release is a GitHub release whose tag matches the version in `manifest.json` exactly, without a `v` prefix. Obsidian downloads `main.js`, `manifest.json`, and `styles.css` from the release assets.

### Before you begin

- Merge the changes that you want to release into `main`.
- [Test the plugin](#test-the-plugin), including in Obsidian.
- If the release uses Obsidian APIs that are newer than the current `minAppVersion`, update `minAppVersion` in `manifest.json`. To find when an API was added, see the `@since` tag in `node_modules/obsidian/obsidian.d.ts`. The linter also reports APIs that are newer than `minAppVersion`.

### Create the release

1. Switch to `main`, and get the latest changes:

   ```bash
   git switch main
   git pull
   ```

1. Update the version number:

   ```bash
   npm version RELEASE_TYPE
   ```

   Replace `RELEASE_TYPE` with `patch`, `minor`, or `major`. Use `major` for changes that break existing settings or behavior, such as raising `minAppVersion`.

   This command updates `package.json`, runs `version-bump.mjs` to copy the version into `manifest.json` and add it to `versions.json`, commits the changes, and creates a Git tag such as `7.1.0`.

1. Build the production files:

   ```bash
   npm run build
   ```

1. Push the commit and the tag:

   ```bash
   git push --follow-tags
   ```

1. On GitHub, create the release:
   1. Go to the repository's **Releases** page, and then click **Draft a new release**.
   1. In **Choose a tag**, select the tag that `npm version` created.
   1. Set the release title to the version number.
   1. In the description, summarize the changes. If the release raises `minAppVersion`, or changes settings or credential storage, say so.
   1. Attach `main.js`, `manifest.json`, and `styles.css` as binary files.
   1. Click **Publish release**.

   If you use the [GitHub CLI](https://cli.github.com/), you can do this step with one command instead:

   ```bash
   gh release create VERSION main.js manifest.json styles.css --title VERSION --notes "RELEASE_NOTES"
   ```

   Replace `VERSION` with the new version, such as `7.1.0`, and `RELEASE_NOTES` with a summary of the changes.

1. Install the release in a clean test vault by following [Install the plugin](#install-the-plugin), and verify that it loads.

**Note:** Don't commit `main.js`. It's listed in `.gitignore` and belongs only in release assets.

### Submit to the community directory

This plugin is a fork. Obsidian lists a fork in its community directory only if the original author approves it publicly, or if the original author has been unreachable and inactive for at least six months. For details, see Obsidian's [developer policies](https://docs.obsidian.md/Developer+policies).

## Report issues

To report a problem with converting or publishing content, open an issue in the [markdown-confluence repository](https://github.com/markdown-confluence/markdown-confluence/issues), where the shared library is developed. To report a problem that's specific to this plugin, open an issue in [this repository](https://github.com/FlyxHub/obsidian-integration-plus/issues).

## Credits and license

Confluence Integration Plus is a fork of the [Confluence Integration](https://github.com/markdown-confluence/obsidian-integration) plugin from the [markdown-confluence](https://github.com/markdown-confluence/markdown-confluence) project, and it uses that project's `@markdown-confluence/lib` library. The Apache 2.0 License requires this notice:

Copyright © 2022 Atlassian Pty Ltd.

Copyright © 2022 Atlassian US, Inc.

This project is licensed under the [Apache 2.0 License](LICENSE).

The Apache license applies only to this plugin. It doesn't apply to any third party's services, websites, content, or platforms that the plugin lets you connect to. The licensors listed in this document don't grant you a license to access any third-party service, website, content, or platform. You're responsible for getting licenses from those third parties and for complying with their terms. Don't disclose passwords, credentials, or tokens to any third-party service in your contributions to this project.
