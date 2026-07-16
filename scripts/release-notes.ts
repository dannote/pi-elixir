#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

export function extractReleaseNotes(markdown: string, version: string): string {
  const document = fromMarkdown(markdown);
  const headingIndex = document.children.findIndex(
    (node) =>
      node.type === "heading" &&
      node.depth === 2 &&
      (toString(node) === version || toString(node).startsWith(`${version} - `)),
  );

  if (headingIndex < 0) throw new Error(`CHANGELOG.md has no level-two heading for ${version}`);

  const heading = document.children[headingIndex];
  const nextHeading = document.children
    .slice(headingIndex + 1)
    .find((node) => node.type === "heading" && node.depth === 2);
  const start = heading.position?.end.offset;
  const end = nextHeading?.position?.start.offset ?? markdown.length;

  if (start === undefined)
    throw new Error(`CHANGELOG.md heading for ${version} has no source offset`);

  const notes = markdown.slice(start, end).trim();
  if (!notes) throw new Error(`CHANGELOG.md has no release notes for ${version}`);
  return `${notes}\n`;
}

export function validateReleaseRef(
  version: string,
  refType: string | undefined,
  refName: string | undefined,
): void {
  if (refType === "tag" && refName !== `v${version}`) {
    throw new Error(`Tag ${refName ?? ""} does not match package version ${version}`);
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json has no release version");
  }

  const expectedTag = `v${packageJson.version}`;
  validateReleaseRef(packageJson.version, process.env.GITHUB_REF_TYPE, process.env.GITHUB_REF_NAME);

  const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
  const notes = extractReleaseNotes(changelog, packageJson.version);
  const output = process.argv[2];

  if (output) {
    await writeFile(output, notes);
    console.log(`Release notes for ${expectedTag} written to ${output}`);
  } else {
    process.stdout.write(notes);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
