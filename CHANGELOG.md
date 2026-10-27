# Changelog

All notable changes to Confluence Integration Plus are listed here. For the history of the plugin this one was forked from, see the [markdown-confluence changelog](https://github.com/markdown-confluence/markdown-confluence/blob/main/CHANGELOG.md).

## 1.2.11 (unreleased)

### Security

- A note or a pulled page with many unclosed HTML comments, or with long multiline link reference definitions, can no longer freeze Obsidian while it's converted. The plugin now uses markdown-it 14.3.3, which parses them in linear time.

## 1.2.10 (2026-10-16)

### Security

- Pulled code blocks are checked by the first word of their language, so a `dataviewjs extra` block becomes `text` like a `dataviewjs` block does. Inline `$=` code is disabled after neighboring code text is joined, so it can't be split to get past the check.
- An attachment named like a note with a trailing space or dot, such as `payload.md `, is no longer downloaded, because its file name would have been `payload.md`.
- A page can no longer freeze Obsidian with a heading level in the millions, or with a long run of `[[` in a code block, which "Publish changes" scans for links.
- A PlantUML server's redirects are followed only within the server's own host, so a redirect can't make the plugin fetch an image from another address and upload it to Confluence.
- Settings imported from the original Confluence Integration plugin can no longer name which secret in Obsidian secret storage this plugin sends, or which OAuth sites it has signed in to.

### Fixed

- Publishing a pulled note that keeps Confluence-hosted images in `adf` blocks no longer fails with "Cannot read properties of undefined (reading 'split')". Those images stay on the page as they are.
- Publishing refuses a note whose `connie-page-id` another note in the vault also has, including notes outside the publish folder and "Publish current note", instead of replacing the other note's page. Pulling skips such pages with a message instead of merging into whichever note comes first.
- A media file ID named like a built-in object member, such as `constructor`, no longer makes its page impossible to pull.
- Browser sign-in refreshes an access token that has less than ten minutes left before a publish or pull, so a long run doesn't fail partway when the token expires.
- Cancelling a pull also stops an attachment download that is in progress.
- A sync snapshot that can't be read is reported instead of being treated as missing, which could discard the merge base or the map of downloaded images.
- An import that fails while creating its note no longer leaves a temporary file behind.
- Notes with a Dataview query inside a callout, quote or list item always publish, as notes with a top-level query do.
- Confluence API responses are limited to 100 MB.

## 1.2.9 (2026-10-14)

### Security

- Pulling no longer lets someone who can edit a Confluence page add Markdown to your notes through a link's section anchor, such as a `dataviewjs` block or an embed of another file. Such links stay web links.
- A page attachment is matched to a file in your vault only when its content is the file that you published, not just when its name matches. Before, an attachment named like one of your files could make the next publish upload that file to the page.
- Pulled `dataviewjs` and other executable code blocks are made inert inside quotes, lists, and panels too, and inline `$=` code with leading spaces is disabled. Pulled Dataview queries (`dataview` blocks) also become `text` blocks, so they can't publish your vault's data. Code blocks that you wrote in Obsidian aren't changed.
- Attachments that Obsidian would open as notes, such as `.md` and `.canvas` files, and files without an extension, aren't downloaded.
- Imported notes are created so that plugins that run commands in new notes, such as Templater, don't run pulled content. An imported page that starts with a divider no longer turns its first lines into frontmatter.
- Theme and snippet CSS can no longer add scripts to the hidden window that renders Mermaid diagrams.

### Fixes

- Pulling keeps more content that was saved in Confluence's editor as readable Markdown instead of `adf` code blocks: smart links to pages in personal spaces, bold or italic text that starts or ends with a space, text with both a link and formatting, and paragraphs that start with a line break. Notes that a pull filled with such blocks get readable text again on the next pull.
- Publishing no longer overwrites an edit that someone saved in Confluence while the publish was running, and a page that someone saved right after a publish keeps its edit for the next pull.
- **Publish changes** no longer skips edits that you made while a publish was running, changes in notes and images embedded in embedded notes, or a change of the Confluence site URL, page header, or page footer.
- Blog posts now get the same check before publishing as pages.
- Two notes linked to the same page, such as a copied note, stop the publish instead of overwriting each other.
- A cancelled or failed retry no longer discards the records of pages that were already published.
- A cancelled pull shows the notes it already updated.
- A pull lists the notes that had no sync history and whose pages you edited last, so you can check them for edits that you made in Confluence before publishing over them.
- A stalled attachment download now times out instead of blocking every later publish and pull.
- Publishing several pages with Mermaid diagrams no longer leaves Obsidian's own diagrams using the publish theme.
- Image sizes no longer split table cells, and images with damaged EXIF data keep their size.
- **Publish current note** on a note that isn't selected for publishing says so instead of reporting success.
- In **Edit page settings for current note**, changing a value now saves it, and clearing **Set** removes the property.
- Imported notes and downloaded images no longer replace a file whose name differs only in case, and imported file names are valid on Windows.
- A pull no longer rewrites a note when only trailing blank lines differ, and a note with a single leftover conflict marker can't be published.
- Damaged sync data now gives an error instead of being treated as missing.
- PlantUML diagrams are requested through the same desktop transport as Kroki, with a size limit. Kroki responses also have a size limit.
- Entering `/` as **Folder to publish** now publishes the whole vault, and the OAuth callback URL can use port 80.

## 1.2.8 (2026-10-08)

### Fixes

- Pulling a Confluence paragraph with a line break after a space no longer turns it into an `adf` code block. Notes that a pull already filled with such blocks get readable text on the next pull.

## 1.2.7 (2026-10-07)

### Fixes

- The bundled `prosemirror-view` is upgraded from 1.41.5 to 1.42.6, outside the range of security advisory [GHSA-c8x8-7fp4-3x9w](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w). Atlassian's document format library pins the older version.

## 1.2.6 (2026-10-07)

### Changes

- The plugin no longer bundles Node's file system module, which the bundled Confluence library includes only for its command-line tool. Obsidian's plugin review no longer reports direct file system access.

## 1.2.5 (2026-10-07)

### Changes

- Internal cleanup that removes unused code and simplifies several modules. Publishing, pulling and settings work as before.

## 1.2.4 (2026-09-28)

### Fixes

- Publishing no longer saves a new Confluence version of an unchanged page that links to a page in a personal space. Before, links to such pages lost the `~` in their space key, so every publish saw the page as changed.

## 1.2.3 (2026-09-28)

### Fixes

- **Publish changes** no longer rejects notes with "Confluence has changes that you haven't pulled" when nobody else edited the page. Notes that a publish sends only to keep the page tree in place, such as folder notes, now have their pull base updated too. To clear a note that is already affected, pull it once.

## 1.2.2 (2026-09-24)

### Fixes

- Callouts whose first line contains an escaped character, such as `\>`, or an HTML entity, such as `&amp;`, publish and pull correctly. Before, publishing such a note failed, and publishing or pulling a page with such a panel showed "Token type `text_special` not supported by Markdown parser".

## 1.2.1 (2026-09-24)

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
