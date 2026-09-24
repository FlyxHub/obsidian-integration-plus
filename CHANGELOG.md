# Changelog

All notable changes to Confluence Integration Plus are listed here. For the history of the plugin this one was forked from, see the [markdown-confluence changelog](https://github.com/markdown-confluence/markdown-confluence/blob/main/CHANGELOG.md).

## 1.2.1 (unreleased)

### Fixes

- Pulling a note with a Mermaid diagram no longer causes a conflict between the diagram's source and its image, and no longer downloads the rendered image into your vault. Pages published with an earlier version are fixed on their next pull.
- Pulled or imported paragraphs that end with a line break (Shift+Enter in Confluence) appear as text instead of an `adf` code block. Notes that already have such a block get the text on their next pull.
- **Publish changes** keeps wikilinks, such as `[[Other note]]`, to published notes that it doesn't republish. Before, those links became plain text in Confluence. Wikilinks now also go to the note that Obsidian opens when two notes have the same name.

## 1.2.0 (2026-09-23)

### Changes

- In Obsidian 1.13 and later, the plugin's settings appear in Obsidian's settings search.
- The plugin is less than half its previous size, about 4 MB instead of 9 MB, so Obsidian Sync Standard can sync it. Mermaid diagrams are now rendered with the Mermaid version that Obsidian uses for your notes, instead of a separate copy.
- Release files come with GitHub artifact attestations, so you can verify that they were built from this repository.

## 1.1.3 (2026-09-23)

### Changes

- The plugin is about 230 KB smaller. The publish results and page settings dialogs no longer use React, and they look and work as before.

## 1.1.2 (2026-09-22)

### Fixes

- Publishing no longer fails with "'/C:\Users\…\Obsidian/' doesn't exist." in vaults whose settings were imported from the original Confluence Integration plugin. The plugin now always publishes notes from the vault root, whatever folder the old settings named.

## 1.1.1 (2026-09-22)

### Fixes

- Images no longer fill the whole Confluence page. Images wider than the new **Maximum image width** setting (700 pixels by default) are scaled down to it.
- An image width set in a note, such as `![[image.png|400]]`, keeps the image's aspect ratio instead of stretching it to its full height.
- The first **Publish changes** after you update publishes every note once, so existing pages get the new image sizes.

## 1.1.0 (2026-09-22)

### Features

- **Publish all notes** is now **Publish changes**: it publishes only the notes that changed since a publish or pull last left them in sync with Confluence, including changes to embedded notes and images. Unchanged notes are skipped, so publishing is faster and isn't blocked by Confluence edits to notes you didn't change. Existing hotkeys keep working.
- **Republish all notes** publishes every selected note, as **Publish all notes** did before. Use it after changing your Obsidian theme or CSS snippets.
- Notes published with an earlier version count as changed until they're published once.

## 1.0.0 (2026-09-22)

First release as Confluence Integration Plus, forked from Confluence Integration 7.0.0.

### Features

- Pull changes made in Confluence into your notes with a three-way merge. Overlapping edits are marked with Git-style conflict markers.
- Import pages that were added under the parent page in Confluence as new notes and folders.
- Stop a publish when Confluence has changes that you haven't pulled, or when a note still has conflict markers.
- Import settings from the original Confluence Integration plugin the first time the plugin loads.
- Pull Confluence info, note, warning, success, and error panels as Obsidian callouts. Notes that were already pulled are reformatted on the next pull.
- Download page images and other attachments into an image folder (`images` by default) when pulling, and embed them in notes. Empty paragraphs from Confluence are left out.
- Pull links to other Confluence pages as wikilinks to their notes, including links between pages imported in the same pull. Notes that were already pulled are updated on the next pull.

### Security

- Keep API tokens and client secrets in Obsidian secret storage instead of `data.json`, and move existing plaintext values there.
- Turn pulled code blocks that plugins run as JavaScript, such as `dataviewjs`, into plain text.
- Only link to `https:` page URLs in the results dialog.

### Changes

- A callout without a title no longer adds its type, such as "Warning", as the first line of the Confluence panel.
- Requires Obsidian 1.11.4 or later.
- Plugin ID is `confluence-integration-plus`, so it installs alongside the original plugin instead of replacing it.
- Commands and settings use sentence case, and styles use Obsidian CSS variables.
