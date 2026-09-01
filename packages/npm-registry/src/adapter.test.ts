import { describe, expect, it } from "vitest";

import type { NpmRegistryAdapter } from "./adapter.js";
import { NpmRegistryError } from "./adapter.js";

const fake: NpmRegistryAdapter = {
  async search() {
    return {
      objects: [],
      total: 0,
      sourceUrl: "https://registry.npmjs.org",
      fetchedAt: "2026-08-28T00:00:00.000Z",
    };
  },
  async getPackument(name) {
    return {
      name,
      "dist-tags": {},
      versions: {},
      sourceUrl: "https://registry.npmjs.org/demo",
      fetchedAt: "2026-08-28T00:00:00.000Z",
    };
  },
  async getWeeklyDownloads(name) {
    return {
      packageName: name,
      downloads: null,
      start: "2026-08-21",
      end: "2026-08-27",
      sourceUrl: "https://api.npmjs.org",
      fetchedAt: "2026-08-28T00:00:00.000Z",
    };
  },
};

describe("npm adapter contract", () => {
  it("can be implemented by a deterministic fake", async () => {
    await expect(fake.search("logger")).resolves.toMatchObject({ total: 0 });
    await expect(fake.getPackument("demo")).resolves.toMatchObject({ name: "demo" });
    await expect(fake.getWeeklyDownloads("demo")).resolves.toMatchObject({ downloads: null });
  });

  it("uses stable typed error codes", () => {
    const error = new NpmRegistryError("RATE_LIMITED", "npm request was rate limited", {
      retryable: true,
      status: 429,
    });
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryable: true, status: 429 });
  });
});
