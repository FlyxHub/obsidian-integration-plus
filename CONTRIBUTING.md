# Contributing to Confluence Integration Plus

This guide is for people who work on the plugin itself. To install and use the plugin, see the [README](README.md).

## Contents

- [Set up a development environment](#set-up-a-development-environment)
- [Test the plugin](#test-the-plugin)
- [Release the plugin](#release-the-plugin)

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
1. [Connect to Confluence](README.md#connect-to-confluence), using your test page as the parent page.
1. In the folder to publish, create a note that contains a heading, an image, and a Mermaid diagram.
1. Run **Publish changes**.
1. Verify the following:
   - The results dialog reports no failures.
   - The page in Confluence shows the heading, image, and diagram.
   - The note's frontmatter contains `connie-page-id` and `connie-page-url`.
   - The developer console shows no errors.
1. Edit the note, publish it again, and verify that the plugin updates the same Confluence page.
1. Start a publish of several notes, and then run **Cancel publish or pull after the current request**. Verify that the publish stops.

#### Test publishing changes

1. Publish several notes in different folders, including a folder with a folder note.
1. Run **Publish changes** without editing anything. Verify that a notice says that no notes changed.
1. Edit one note in a subfolder, and then run **Publish changes**. Verify the following:
   - The results list only that note.
   - In Confluence, the page is still under the same parent page, and the folder note's page is unchanged.
1. Edit an image that a note embeds, and run **Publish changes**. Verify that the note that embeds it is published.
1. Change **Mermaid theme**, and run **Publish changes**. Verify that every note is published.
1. Run **Republish all notes**. Verify that every note is published, and that **Apply page ordering** runs if it's on.

#### Test pulling

These steps need a second Confluence account, or a colleague, to act as the other editor.

1. Publish a note that contains a Mermaid diagram and at least three paragraphs.
1. Run **Pull all notes**. Verify that the dialog reports the note as unchanged.
1. As the other user, edit the last paragraph in Confluence.
1. In Obsidian, edit the first paragraph, and then run **Publish changes**. Verify that nothing is published and the dialog says to pull the note first.
1. Run **Pull all notes**. Verify the following:
   - The dialog lists the note as updated.
   - The note contains your edit, the Confluence edit, and the Mermaid source.
1. Run **Publish changes**, and verify that the page in Confluence shows both edits.
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

GitHub Actions builds and publishes each release. When you push a version tag, the `Release` workflow (`.github/workflows/release.yml`) checks that the tag matches `manifest.json`, runs the linter and the tests, builds `main.js`, creates [artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) for the three files, and creates the GitHub release with the version's changelog section as its notes. Don't upload release files by hand: files that the workflow didn't build have no attestation.

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

1. Confirm the version. Each feature branch sets the next version when it starts, so `manifest.json` already has the version that you're releasing. The major version stays at 1: major feature updates and breaking changes, such as raising `minAppVersion`, increase the second number (`1.2.0`), and minor updates and fixes increase the third (`1.2.1`).

1. In `CHANGELOG.md`, replace `(unreleased)` in the version's heading with today's date, and commit the change.

1. Tag the release commit:

   ```bash
   git tag -a VERSION -m VERSION
   ```

   Replace `VERSION` with the version in `manifest.json`, such as `1.2.0`. The tag has no `v` prefix.

1. Push the commit and the tag:

   ```bash
   git push --follow-tags
   ```

1. On the repository's **Actions** page, wait for the **Release** workflow to finish, and then check the new release on the **Releases** page. If the release raises `minAppVersion`, or changes settings or credential storage, make sure its changelog section says so.

   To verify a downloaded file's attestation, run `gh attestation verify main.js --repo FlyxHub/obsidian-integration-plus`.

1. Install the release in a clean test vault by following [Install the plugin](README.md#install-the-plugin), and verify that it loads.

**Note:** Don't commit `main.js`. It's listed in `.gitignore` and belongs only in release assets.

### Submit to the community directory

This plugin is a fork. Obsidian lists a fork in its community directory only if the original author approves it publicly, or if the original author has been unreachable and inactive for at least six months. For details, see Obsidian's [developer policies](https://docs.obsidian.md/Developer+policies).
