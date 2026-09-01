import { describe, expect, it } from "vitest";

import type { NpmPackument } from "./adapter.js";
import { extractLicenseSignal, extractPackageSize } from "./package-signals.js";

const base: NpmPackument = {
  name: "demo",
  "dist-tags": {},
  versions: {},
  sourceUrl: "https://registry.npmjs.org/demo",
  fetchedAt: "2026-08-28T00:00:00.000Z",
};

describe("npm license and package size signals", () => {
  it("keeps unknown and multiple licenses explicit", () => {
    expect(extractLicenseSignal(base)).toEqual({
      status: "unknown",
      expression: null,
      identifiers: [],
    });
    expect(extractLicenseSignal({ ...base, license: ["MIT", { type: "Apache-2.0" }] })).toEqual({
      status: "multiple",
      expression: "MIT OR Apache-2.0",
      identifiers: ["MIT", "Apache-2.0"],
    });
    expect(extractLicenseSignal({ ...base, license: "SEE LICENSE IN LICENSE.txt" })).toMatchObject({
      status: "custom",
    });
  });

  it("extracts unpacked size without fetching or executing a tarball", () => {
    expect(
      extractPackageSize({
        name: "demo",
        version: "1.0.0",
        dist: { unpackedSize: 1_500_000, fileCount: 42 },
      }),
    ).toEqual({ unpackedBytes: 1_500_000, fileCount: 42, tier: "large" });
    expect(extractPackageSize({ name: "demo", version: "1.0.0" })).toMatchObject({
      unpackedBytes: null,
      tier: "unknown",
    });
  });
});
