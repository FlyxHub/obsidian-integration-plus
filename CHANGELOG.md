# Changelog

All notable changes to Confluence Integration Plus are listed here. For the history of the plugin this one was forked from, see the [markdown-confluence changelog](https://github.com/markdown-confluence/markdown-confluence/blob/main/CHANGELOG.md).

## 1.0.0 (unreleased)

First release as Confluence Integration Plus, forked from Confluence Integration 7.0.0.

### Features

- Pull changes made in Confluence into your notes with a three-way merge. Overlapping edits are marked with Git-style conflict markers.
- Import pages that were added under the parent page in Confluence as new notes and folders.
- Stop a publish when Confluence has changes that you haven't pulled, or when a note still has conflict markers.
- Import settings from the original Confluence Integration plugin the first time the plugin loads.
- Pull Confluence info, note, warning, success, and error panels as Obsidian callouts. Notes that were already pulled are reformatted on the next pull.

### Security

- Keep API tokens and client secrets in Obsidian secret storage instead of `data.json`, and move existing plaintext values there.
- Turn pulled code blocks that plugins run as JavaScript, such as `dataviewjs`, into plain text.
- Only link to `https:` page URLs in the results dialog.

### Changes

- A callout without a title no longer adds its type, such as "Warning", as the first line of the Confluence panel.
- Requires Obsidian 1.11.4 or later.
- Plugin ID is `confluence-integration-plus`, so it installs alongside the original plugin instead of replacing it.
- Commands and settings use sentence case, and styles use Obsidian CSS variables.
