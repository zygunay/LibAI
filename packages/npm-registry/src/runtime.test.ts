import { describe, expect, it } from "vitest";

import type { NpmPackageVersion } from "./adapter.js";
import { extractRuntimeCompatibility } from "./runtime.js";

const metadata = (node?: string): NpmPackageVersion => ({
  name: "demo",
  version: "1.0.0",
  ...(node ? { engines: { node, npm: ">=10" } } : {}),
});

describe("npm runtime compatibility", () => {
  it.each([
    [">=20", "24.0.0", "compatible"],
    ["20.x || 22.x", "24.0.0", "incompatible"],
    ["^24.0.0-0", "24.0.0-beta.1", "compatible"],
  ] as const)("evaluates %s against %s", (range, target, compatibility) => {
    expect(extractRuntimeCompatibility(metadata(range), target)).toMatchObject({
      nodeRangeValid: true,
      compatibility,
    });
  });

  it("keeps missing and invalid engine declarations unknown", () => {
    expect(extractRuntimeCompatibility(metadata())).toMatchObject({
      nodeRange: null,
      nodeRangeValid: null,
      compatibility: "unknown",
    });
    expect(extractRuntimeCompatibility(metadata("not-semver"), "24.0.0")).toMatchObject({
      nodeRangeValid: false,
      compatibility: "unknown",
    });
  });
});
