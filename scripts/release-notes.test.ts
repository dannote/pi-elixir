import assert from "node:assert/strict";
import test from "node:test";

import { extractReleaseNotes } from "./release-notes.ts";

test("extracts one version section using Markdown heading boundaries", () => {
  const changelog = `# Changelog

## Unreleased

## 1.2.3 - 2026-07-10

### Fixed

- Kept exact wording.

## 1.2.2 - 2026-07-09

- Previous release.
`;

  assert.equal(extractReleaseNotes(changelog, "1.2.3"), "### Fixed\n\n- Kept exact wording.\n");
});

test("does not confuse a version with a longer version prefix", () => {
  const changelog = `## 1.2.30 - 2026-07-10

- Different release.
`;

  assert.throws(() => extractReleaseNotes(changelog, "1.2.3"), /no level-two heading/u);
});
