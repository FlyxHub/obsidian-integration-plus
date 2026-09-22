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
- [Report issues](#report-issues)
- [Credits and license](#credits-and-license)

## Disclosures

Obsidian's developer policies require plugins to disclose the following behavior:

- **Account:** You need an Atlassian Cloud account with access to a Confluence site.
- **Network use:** The plugin sends note content, attachments, labels, and page metadata over HTTPS to the Confluence site that you configure. When you pull, it reads pages from that site and writes their content into your notes, and downloads page images and other attachments from Atlassian's media service (`*.atlassian.com`) into your vault. Confluence credentials are never sent to the media service. It contacts `auth.atlassian.com` and `api.atlassian.com` only to sign in with OAuth and to refresh tokens. If you turn on Kroki or PlantUML rendering, the plugin sends diagram source to the server that you configure. The plugin doesn't collect telemetry.
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

To connect, choose an authentication method, set it up, and then tell the plugin where to publish.

### Before you begin

Find the ID of the Confluence page that you want to publish notes under. The ID is the number after `/pages/` in the page URL. For example, the ID in `https://example.atlassian.net/wiki/spaces/DOCS/pages/123456/Home` is `123456`.

### Choose an authentication method

The plugin supports four authentication methods:

| Method                                                      | Use it when                                                                                        | What you need                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [API token (basic)](#use-an-api-token)                      | You publish as yourself. This method is the quickest to set up.                                    | Your Atlassian email address and an API token.                     |
| [Bearer token or PAT](#use-a-bearer-token)                  | You have a token that Confluence accepts as a bearer token, such as a service account's API token. | The token.                                                         |
| [OAuth service account](#use-an-oauth-service-account)      | Your organization publishes through a service account instead of a person.                         | A client ID and client secret from Atlassian Administration.       |
| [OAuth browser sign-in](#sign-in-with-oauth-in-the-browser) | You want to sign in with your Atlassian account instead of storing a long-lived token.             | An OAuth app that you register in the Atlassian developer console. |

Some methods need your site's cloud ID. To find it, open `https://SITE.atlassian.net/_edge/tenant_info` in a browser, and replace `SITE` with your site's name. The page shows a `cloudId` value.

The plugin keeps tokens and secrets in Obsidian secret storage, never in `data.json`. When a setting asks for a secret, select an existing secret or create one, and then paste the value into it.

### Confluence scopes

If your token or app asks you to choose scopes, give it the following Confluence scopes:

- `read:page:confluence` and `write:page:confluence`
- `read:attachment:confluence` and `write:attachment:confluence`
- `read:label:confluence` and `write:label:confluence`
- `read:content.restriction:confluence` and `write:content.restriction:confluence`
- `read:space:confluence`
- `read:content.metadata:confluence`
- `read:content-details:confluence`
- `read:confluence-user`

### Use an API token

1. Go to [API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) in your Atlassian account, and create an API token. If you create a token with scopes, give it the [Confluence scopes](#confluence-scopes).
1. Copy the token. Atlassian shows it only once.
1. In Obsidian, go to **Settings** > **Confluence Integration Plus**.
1. In the **Authentication type** list, select **API token (basic)**.
1. In **Confluence site URL**, enter the address that you open in a browser, such as `https://example.atlassian.net`.
1. In **Confluence API URL**, do one of the following:
   - If you created a token without scopes, leave the setting empty.
   - If you created a token with scopes, enter `https://api.atlassian.com/ex/confluence/CLOUD_ID`. Replace `CLOUD_ID` with your site's cloud ID.
1. In **Atlassian username**, enter the email address of your Atlassian account.
1. In **Atlassian API token**, select or create a secret that contains the token.
1. [Finish the setup](#finish-the-setup).

### Use a bearer token

The plugin sends the token in an `Authorization: Bearer` header. Use this method for a service account's API token, or for another token that your site accepts as a bearer token.

1. Get the token. For a service account, go to **Directory** > **Service accounts** in [Atlassian Administration](https://admin.atlassian.com), open the service account, and create an API token with the [Confluence scopes](#confluence-scopes).
1. In Obsidian, go to **Settings** > **Confluence Integration Plus**.
1. In the **Authentication type** list, select **Bearer token or PAT**.
1. In **Confluence site URL**, enter the address that you open in a browser, such as `https://example.atlassian.net`.
1. In **Confluence API URL**, do one of the following:
   - For a service account's API token, enter `https://api.atlassian.com/ex/confluence/CLOUD_ID`. Replace `CLOUD_ID` with your site's cloud ID.
   - For a token that works with your site's own address, leave the setting empty.
1. In **Atlassian API token**, select or create a secret that contains the token.
1. [Finish the setup](#finish-the-setup).

### Use an OAuth service account

With this method, the plugin uses the service account's client ID and client secret to request a new access token each time that you publish or pull. Pages that you publish this way are created and edited by the service account.

1. In [Atlassian Administration](https://admin.atlassian.com), go to **Directory** > **Service accounts**, and open or create a service account.
1. Give the service account access to Confluence, and permission to edit the space that you publish to.
1. Create an OAuth 2.0 credential for the service account, and give it the [Confluence scopes](#confluence-scopes).
1. Copy the client ID and client secret. Atlassian shows the secret only once.
1. In Obsidian, go to **Settings** > **Confluence Integration Plus**.
1. In the **Authentication type** list, select **OAuth service account**.
1. In **Confluence site URL**, enter the address that you open in a browser, such as `https://example.atlassian.net`.
1. In **Confluence API URL**, enter `https://api.atlassian.com/ex/confluence/CLOUD_ID`. Replace `CLOUD_ID` with your site's cloud ID. This method requires this setting.
1. In **OAuth client ID**, enter the client ID.
1. In **OAuth client secret**, select or create a secret that contains the client secret.
1. [Finish the setup](#finish-the-setup).

### Sign in with OAuth in the browser

With this method, you sign in to Atlassian in your browser and choose a site. The plugin keeps the access and refresh tokens in secret storage and renews them for you.

This method needs an OAuth 2.0 (3LO) app that's registered with Atlassian. You register the app once, and then each person signs in with their own Atlassian account.

#### Register an OAuth app

1. Go to the [Atlassian developer console](https://developer.atlassian.com/console/myapps/), and create an OAuth 2.0 integration.
1. Go to **Permissions**, add the **Confluence API**, and then add the [Confluence scopes](#confluence-scopes). You don't need to add `offline_access`; the plugin requests it when you sign in, so that it can renew your tokens.
1. Go to **Authorization**, and add OAuth 2.0 (3LO). In **Callback URL**, enter `http://127.0.0.1:8766/callback`. If another program uses port 8766 on your computer, choose a different port, and enter the same URL in the plugin's **Callback URL** setting later.
1. Go to **Settings**, and copy the client ID and secret.

#### Connect the plugin

1. In Obsidian, go to **Settings** > **Confluence Integration Plus**.
1. In the **Authentication type** list, select **OAuth browser sign-in**.
1. In the **Login method** list, select one of the following:
   - **Browser login:** After you sign in, Atlassian returns you to the plugin through the callback URL. Use this method unless you can't.
   - **Device code:** You enter a code on an Atlassian page, and the plugin doesn't start a local listener. This method works only if Atlassian enabled the device authorization grant for your app.
1. In **OAuth client ID**, enter the app's client ID.
1. In **OAuth client secret**, enter the app's secret. Leave it empty only if Atlassian approved your app as a public client.
1. If you selected **Browser login**, check that **Callback URL** exactly matches the callback URL that you registered. It must have the form `http://127.0.0.1:PORT/callback`.
1. Click **Connect to Atlassian**. Your browser opens. Then, do one of the following:
   - For **Browser login**, sign in, choose your site, and then click **Accept**. When the page says that you can close the tab, return to Obsidian.
   - For **Device code**, the plugin shows **Your device code**. Click **Copy code**, enter the code on the page that opened, and then approve access.
1. In the **Confluence site** list, select the site to publish to. The plugin fills in the site and API URLs.
1. [Finish the setup](#finish-the-setup).
1. Optional: To check the connection, click **Test connection**. The plugin reads the parent page and shows its title.

To sign out, click **Disconnect**, which removes this vault's tokens. To revoke the plugin's access completely, also remove the app from **Connected apps** in your Atlassian account settings. The app settings are locked while you're connected; to change them, disconnect first.

### Finish the setup

After you set up authentication, do the following on the same settings tab:

1. In **Parent page ID**, enter the page ID that you found earlier.
1. In **Folder to publish**, enter the vault folder that contains the notes to publish.

If a setting needs attention, the plugin lists it at the top of the settings tab.

## Publish notes

To publish notes, do any of the following:

- To publish the notes that you changed, click **Publish changes to Confluence** (the cloud upload icon) in the ribbon, or run **Publish changes** from the command palette.
- To publish only the active note, run **Publish current note**. It publishes the note even if it hasn't changed.
- To publish every selected note, run **Republish all notes**.
- To stop a publish or pull, click the status bar item or run **Cancel publish or pull after the current request**. The plugin keeps pages that it already wrote.

After a note is published, the plugin adds `connie-page-id` and `connie-page-url` to its frontmatter.

To manage an existing Confluence page from Obsidian, create a note and set its `connie-page-id` property to the page ID.

### What counts as a change

**Publish changes** sends only the notes that changed since a publish or pull last left them in sync with Confluence. A note counts as changed when any of the following is true:

- You edited its text or frontmatter, or moved or renamed it.
- A note or image that it embeds changed, or a note that it links to was published for the first time.
- It hasn't been published yet, or it was last published with an earlier version of this plugin.
- It contains a Dataview query, and **Publish Dataview results** is on. Query results can change without the note changing, so these notes are always published.
- You changed a setting that affects publishing, such as the parent page, the folder to publish, or a diagram setting. Every note counts as changed.

Pulling keeps this up to date. A note that was in sync before a pull stays in sync if Confluence's changes merge cleanly. A note that has your unpublished edits stays marked as changed after a pull.

To also publish the folder pages above them, **Publish changes** sends the folder notes of the folders that changed notes are in. Those folder notes aren't listed in the results unless they fail, but they go through the same checks as changed notes: a folder note with conflict markers or unpulled Confluence changes stops the publish. **Apply page ordering** runs only with **Republish all notes**.

Run **Republish all notes** after you change your Obsidian theme or CSS snippets, which the plugin can't detect, or whenever you want every page to match your notes.

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

Images and other attachments are downloaded into the **Image folder** (by default, `images` at the root of your vault), and notes embed them, such as `![[diagram.png]]`. Each attachment is downloaded once; later pulls reuse the file. If a file with the same name already exists, the plugin adds a number to the new file's name. When you publish, the image is uploaded to the page again.

Links to other Confluence pages become Obsidian wikilinks when the linked page has a note, such as `[[Local Admin Access]]` or `[[Local Admin Access|the admin page]]`. A link to a section becomes a heading link, such as `[[Local Admin Access#Steps to follow]]`. Links to pages that don't have a note yet stay web links; after a later pull imports those pages, the next pull turns the links into wikilinks. When you publish, wikilinks become links to the Confluence pages again.

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

- An image whose attachment can't be found or downloaded stays an `adf` code block, and the results dialog says why. Images inside tables and other blocks that Markdown can't represent also stay in `adf` code blocks.
- Publishing a pulled image uploads your local copy as a new attachment, so the page keeps the original attachment as well.
- Attachments larger than 100 MB aren't downloaded.
- Content that Markdown can't represent, such as status lozenges, page layouts, and custom panels with their own icon or color, appears as an `adf` code block. Edit these blocks in Confluence.
- For security, pulled code blocks that plugins run as JavaScript, such as `dataviewjs` and `js-engine`, become plain `text` code blocks, and Dataview inline JavaScript (`` `$= ...` ``) is disabled. This prevents anyone who can edit a Confluence page from running code in your vault. Code blocks that you wrote in Obsidian aren't changed.
- Short share links, such as `https://example.atlassian.net/wiki/x/AbCd`, don't contain a page ID, so they stay web links.
- Confluence builds section anchors from heading text, so a heading link can be approximate when a heading contains hyphens or punctuation. The link still opens the right note.
- A smart link card to a page becomes a wikilink, and publishes back as an ordinary link with the page title.
- Pull applies changes line by line. If you and someone in Confluence edit the same paragraph, the whole paragraph is a conflict.

## Diagrams, equations, and embeds

- **Embeds:** The plugin expands note embeds, such as `![[Shared Notes/Release Checklist]]`, before publishing.
- **Image size:** Images wider than **Maximum image width** (700 pixels by default) are scaled down to that width in Confluence, close to how Obsidian shows them. To set the width of one image, add it to the embed, such as `![[diagram.png|400]]` or `![Diagram|400](diagram.png)`. The height follows from the image's shape. To set both, use `WIDTHxHEIGHT`, such as `![[diagram.png|400x300]]`. Your notes aren't changed.
- **Callouts and panels:** Callouts publish as Confluence panels, and pulled panels become callouts. Info, note, warning, and success panels match the callout of the same name, and error panels match `[!failure]`. A callout without a title publishes only its text, because the panel's icon shows its type. A callout with a title publishes the title as the panel's first line. Other callout types publish as info panels or custom panels.
- **Mermaid and LaTeX:** The plugin renders Mermaid diagrams and LaTeX equations on your computer.
- **Kroki and PlantUML:** Kroki (`kroki-*` code blocks) and PlantUML (`plantuml`, `puml`, and `uml` code blocks) are off by default. When you turn them on, the plugin sends diagram source to the server that you configure. Use a server that you trust, such as a self-hosted instance.
- **Dataview:** If Dataview is installed and **Publish Dataview results** is on, the plugin publishes the results of Dataview `TABLE`, `LIST`, and `TASK` queries. DataviewJS and inline queries aren't supported.

## Report issues

To report a problem with converting or publishing content, open an issue in the [markdown-confluence repository](https://github.com/markdown-confluence/markdown-confluence/issues), where the shared library is developed. To report a problem that's specific to this plugin, open an issue in [this repository](https://github.com/FlyxHub/obsidian-integration-plus/issues).

## Credits and license

Confluence Integration Plus is a fork of the [Confluence Integration](https://github.com/markdown-confluence/obsidian-integration) plugin from the [markdown-confluence](https://github.com/markdown-confluence/markdown-confluence) project, and it uses that project's `@markdown-confluence/lib` library. The Apache 2.0 License requires this notice:

Copyright © 2022 Atlassian Pty Ltd.

Copyright © 2022 Atlassian US, Inc.

This project is licensed under the [Apache 2.0 License](LICENSE).

The Apache license applies only to this plugin. It doesn't apply to any third party's services, websites, content, or platforms that the plugin lets you connect to. The licensors listed in this document don't grant you a license to access any third-party service, website, content, or platform. You're responsible for getting licenses from those third parties and for complying with their terms. Don't disclose passwords, credentials, or tokens to any third-party service in your contributions to this project.
