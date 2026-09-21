import { readFileSync } from "node:fs";
import { expect, test } from "@effect/vitest";

const readJson = (path: string) =>
	JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as Record<
		string,
		unknown
	>;

test("package, lockfile, manifest and versions.json all carry the same version", () => {
	const version = readJson("package.json")["version"];
	const lock = readJson("package-lock.json");
	const manifest = readJson("manifest.json");
	const versions = readJson("versions.json");

	expect(lock["version"]).toBe(version);
	expect((lock["packages"] as Record<string, { version?: string }>)[""]?.version).toBe(version);
	expect(manifest["version"]).toBe(version);
	expect(versions[String(version)]).toBe(manifest["minAppVersion"]);
});

test("the changelog has an entry for the current version", () => {
	const { version } = readJson("package.json");
	const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
	const headings = changelog.split(/\r?\n/).filter((line) => line.startsWith("## "));
	expect(
		headings.some(
			(line) => line === `## ${String(version)}` || line.startsWith(`## ${String(version)} `),
		),
	).toBe(true);
});
