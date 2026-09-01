import { describe, expect, it } from "vitest";

import type { NpmPackument } from "./adapter.js";
import { extractPackageIdentity } from "./identity.js";

const packument = (repository: unknown, homepage: unknown = undefined): NpmPackument => ({
  name: "demo",
  "dist-tags": {},
  versions: {},
  repository,
  homepage,
  sourceUrl: "https://registry.npmjs.org/demo",
  fetchedAt: "2026-08-28T00:00:00.000Z",
});

describe("npm package identity", () => {
  it.each([
    "git+https://github.com/acme/demo.git",
    "git://github.com/acme/demo.git",
    "git@github.com:acme/demo.git",
    "acme/demo",
  ])("normalizes repository format %s", (repository) => {
    expect(extractPackageIdentity(packument(repository))).toMatchObject({
      repositoryUrl: "https://github.com/acme/demo",
      github: { owner: "acme", repository: "demo" },
    });
  });

  it("supports object URLs and safely returns null for malformed identities", () => {
    expect(
      extractPackageIdentity(
        packument({ type: "git", url: "https://gitlab.com/acme/demo.git" }, "https://demo.dev"),
      ),
    ).toMatchObject({
      repositoryUrl: "https://gitlab.com/acme/demo",
      homepageUrl: "https://demo.dev/",
      github: null,
    });
    expect(extractPackageIdentity(packument("not a url", "javascript:alert(1)"))).toEqual({
      repositoryUrl: null,
      homepageUrl: null,
      github: null,
    });
  });
});
