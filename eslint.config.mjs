import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		ignores: ["main.js", "node_modules/**", "*.config.*", "version-bump.mjs"],
	},
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: [],
				},
			},
		},
		rules: {
			// Setting `brands` replaces the plugin's default list, so Obsidian is repeated here.
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: [
						"Obsidian",
						"Atlassian",
						"Atlassian Administration",
						"Confluence Integration",
						"Confluence",
						"Jira",
						"Mermaid",
						"Kroki",
						"PlantUML",
						"Dataview",
						"DataviewJS",
						"LaTeX",
						"OAuth",
						"JSON",
					],
					acronyms: ["API", "ID", "URL", "HTTPS", "PAT", "PNG", "SVG", "TABLE", "LIST", "TASK"],
					// Placeholders that show literal example input.
					ignoreRegex: ["^https?://", "^docs, public$", "^images$"],
				},
			],
			// isDesktopOnly is true: the OAuth loopback server and HTTPS transport need Node.
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
	{
		// Tests inspect mocked request bodies parsed from JSON.
		files: ["src/**/*.test.ts"],
		rules: {
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-return": "off",
		},
	},
]);
