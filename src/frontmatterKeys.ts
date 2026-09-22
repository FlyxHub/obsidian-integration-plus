import { ConfluencePageConfig } from "@markdown-confluence/lib";

const config = ConfluencePageConfig.conniePerPageConfig;

/** `connie-page-id`: the Confluence page a note is published to. */
export const PAGE_ID_KEY = config.pageId.key;
/** `connie-title`: the page title, when it differs from the note name. */
export const PAGE_TITLE_KEY = config.pageTitle.key;
/** `connie-publish`: publish a note that folder or tag rules don't select, or skip one. */
export const PUBLISH_KEY = config.publish.key;
