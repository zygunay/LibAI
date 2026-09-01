import { describe, expect, it } from "vitest";

import packumentFixture from "../fixtures/packument.json" with { type: "json" };
import searchFixture from "../fixtures/search.json" with { type: "json" };
import { NpmRegistryClient, selectPackageVersion } from "./client.js";
import { extractPackageIdentity } from "./identity.js";
import { extractModuleSignals } from "./module-signals.js";
import { extractLicenseSignal, extractPackageSize } from "./package-signals.js";
import { extractRuntimeCompatibility } from "./runtime.js";
import { assessPackageStatus } from "./status.js";

describe("recorded npm contract", () => {
  it("runs search-to-evidence extraction without network access", async () => {
    const client = new NpmRegistryClient({
      now: () => new Date("2026-08-28T00:00:00.000Z"),
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/-/v1/search") return Response.json(searchFixture);
        if (path === "/demo-package") return Response.json(packumentFixture);
        if (path.startsWith("/downloads/point/")) {
          return Response.json({ package: "demo-package", downloads: 12345 });
        }
        return new Response(null, { status: 404 });
      },
    });
    const search = await client.search("demo package");
    const packument = await client.getPackument(search.objects[0]?.name ?? "");
    const version = selectPackageVersion(packument);
    const downloads = await client.getWeeklyDownloads(packument.name);
    expect({
      status: assessPackageStatus(packument),
      identity: extractPackageIdentity(packument, version),
      runtime: extractRuntimeCompatibility(version, "24.0.0"),
      modules: extractModuleSignals(version),
      license: extractLicenseSignal(packument, version),
      size: extractPackageSize(version),
      downloads: downloads.downloads,
    }).toMatchObject({
      status: { availability: "active" },
      identity: { github: { owner: "acme", repository: "demo-package" } },
      runtime: { compatibility: "compatible" },
      modules: { moduleFormat: "esm", types: "bundled" },
      license: { status: "multiple" },
      size: { tier: "small" },
      downloads: 12345,
    });
  });
});

const liveTest = process.env.RUN_LIVE_NPM_TESTS === "1" ? it : it.skip;

describe("live npm smoke (opt-in)", () => {
  liveTest(
    "queries public npm endpoints without credentials",
    async () => {
      const client = new NpmRegistryClient({ timeoutMs: 15_000 });
      const search = await client.search("pino logger", { limit: 1 });
      expect(search.objects.length).toBeGreaterThan(0);
      const packument = await client.getPackument("pino");
      expect(selectPackageVersion(packument).name).toBe("pino");
      await expect(client.getWeeklyDownloads("pino")).resolves.toMatchObject({
        packageName: "pino",
      });
    },
    30_000,
  );
});
