import { describe, expect, it } from "vitest";

import type { NpmPackument } from "./adapter.js";
import { assessPackageStatus } from "./status.js";

const base: NpmPackument = {
  name: "demo",
  "dist-tags": { latest: "1.0.0" },
  versions: { "1.0.0": { name: "demo", version: "1.0.0" } },
  sourceUrl: "https://registry.npmjs.org/demo",
  fetchedAt: "2026-08-28T00:00:00.000Z",
};

describe("npm package status", () => {
  it("automatically flags a deprecated selected version", () => {
    expect(
      assessPackageStatus({
        ...base,
        versions: {
          "1.0.0": { name: "demo", version: "1.0.0", deprecated: "Use demo-next" },
        },
      }),
    ).toEqual({
      availability: "deprecated",
      deprecated: true,
      yankedLike: false,
      selectedVersion: "1.0.0",
      message: "Use demo-next",
    });
  });

  it("models missing and unpublished versions without claiming npm has a yanked flag", () => {
    expect(assessPackageStatus({ ...base, versions: {} })).toMatchObject({
      availability: "unknown",
      yankedLike: true,
    });
    expect(
      assessPackageStatus({ ...base, time: { unpublished: "2026-08-01T00:00:00Z" } }),
    ).toMatchObject({
      availability: "unpublished",
      yankedLike: true,
    });
  });
});
