import { describe, expect, it } from "vitest";
import {
  PyPiAdapter,
  canonicalPythonName,
  canonicalPythonRepository,
  ecosystemEnabled,
  routeEcosystem,
  scoringProfiles,
  type RegistryAdapter,
} from "./index.js";
describe("multi-ecosystem pilot", () => {
  it("exposes a generalized registry capability contract", () => {
    const adapter: RegistryAdapter = new PyPiAdapter({
      fetch: async () =>
        Response.json({
          info: {
            name: "Demo_Pkg",
            version: "1.0",
            summary: "demo",
            license: "MIT",
            project_urls: { Source: "https://github.com/acme/demo-pkg" },
          },
        }),
      now: () => new Date("2026-08-28T00:00:00Z"),
    });
    expect(adapter.capabilities).toMatchObject({
      ecosystem: "pypi",
      exactMetadata: true,
      fullTextSearch: false,
    });
    return expect(adapter.getProject("demo.pkg")).resolves.toMatchObject({
      name: "demo-pkg",
      repositoryUrl: "https://github.com/acme/demo-pkg",
      license: "MIT",
    });
  });
  it("normalizes Python names and maps only safe GitHub identities", () => {
    expect(canonicalPythonName("My_Package.Name")).toBe("my-package-name");
    expect(canonicalPythonRepository("demo", "https://github.com/Acme/Demo.git")).toEqual({
      packageId: "pypi:demo",
      repositoryId: "github:acme/demo",
    });
    expect(
      canonicalPythonRepository("demo", "https://gitlab.com/acme/demo").repositoryId,
    ).toBeNull();
  });
  it("uses an ecosystem-specific score profile", () => {
    expect(scoringProfiles.pypi.compatibility).not.toBe(scoringProfiles.npm.compatibility);
    expect(Object.values(scoringProfiles.pypi).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it("routes explicit ecosystems and asks on ambiguity", () => {
    expect(routeEcosystem("FastAPI için validator")).toEqual({
      ecosystem: "pypi",
      clarificationNeeded: false,
    });
    expect(routeEcosystem("React ile Django istemcisi")).toEqual({
      ecosystem: "ambiguous",
      clarificationNeeded: true,
    });
    expect(routeEcosystem("bir validator").clarificationNeeded).toBe(true);
  });
  it("keeps PyPI behind an independent rollout flag", () => {
    expect(ecosystemEnabled("npm", {})).toBe(true);
    expect(ecosystemEnabled("pypi", {})).toBe(false);
    expect(ecosystemEnabled("pypi", { LIBAI_PYPI_ENABLED: "1" })).toBe(true);
  });
});
const live = process.env.RUN_LIVE_PYPI_TESTS === "1" ? it : it.skip;
describe("live PyPI smoke (opt-in)", () => {
  live(
    "loads exact public metadata",
    async () => {
      await expect(
        new PyPiAdapter({ timeoutMs: 15_000 }).getProject("requests"),
      ).resolves.toMatchObject({ ecosystem: "pypi", name: "requests" });
    },
    30_000,
  );
});
