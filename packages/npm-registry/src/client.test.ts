import { describe, expect, it, vi } from "vitest";

import { NpmRegistryError } from "./adapter.js";
import { NpmRegistryClient } from "./client.js";

describe("npm registry search client", () => {
  it("builds an encoded search request and normalizes its fixture", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        total: 1,
        objects: [
          {
            package: {
              name: "pino",
              version: "9.0.0",
              description: "logger",
              keywords: ["log", 42],
              publisher: { username: "maintainer", email: "private@example.com" },
              date: "2026-08-20T00:00:00.000Z",
            },
            score: { final: 0.91 },
          },
        ],
      }),
    );
    const client = new NpmRegistryClient({
      fetch: fetcher,
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });
    const result = await client.search("structured logger", { limit: 5, from: 10 });
    const requestedUrl = String(fetcher.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("text=structured+logger");
    expect(requestedUrl).toContain("size=5");
    expect(result).toMatchObject({
      total: 1,
      objects: [{ name: "pino", keywords: ["log"], score: 0.91 }],
    });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });

  it("maps malformed and rate-limited responses to stable errors", async () => {
    const malformed = new NpmRegistryClient({ fetch: async () => Response.json({ objects: [] }) });
    await expect(malformed.search("logger")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const limited = new NpmRegistryClient({
      fetch: async () => new Response(null, { status: 429 }),
    });
    await expect(limited.search("logger")).rejects.toEqual(expect.any(NpmRegistryError));
    await expect(limited.search("logger")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it.each(["demo", "@scope/demo"])(
    "collects packument and version metadata for %s",
    async (name) => {
      const fetcher = vi.fn(async () =>
        Response.json({
          name,
          description: "fixture",
          "dist-tags": { latest: "2.0.0" },
          versions: {
            "2.0.0": {
              name,
              version: "2.0.0",
              engines: { node: ">=20", invalid: 42 },
              dist: { tarball: "https://registry.npmjs.org/demo.tgz", unpackedSize: 1234 },
            },
          },
        }),
      );
      const client = new NpmRegistryClient({
        fetch: fetcher,
        now: () => new Date("2026-08-28T00:00:00.000Z"),
      });
      const packument = await client.getPackument(name);
      expect(packument.versions["2.0.0"]).toMatchObject({
        version: "2.0.0",
        engines: { node: ">=20" },
      });
      expect(decodeURIComponent(new URL(String(fetcher.mock.calls[0]?.[0])).pathname)).toBe(
        `/${name}`,
      );
    },
  );

  it("collects a seven-day download window and preserves missing data as null", async () => {
    const fetcher = vi.fn(async () => Response.json({ package: "demo" }));
    const client = new NpmRegistryClient({
      fetch: fetcher,
      now: () => new Date("2026-08-28T15:00:00.000Z"),
    });
    const result = await client.getWeeklyDownloads("demo");
    expect(result).toMatchObject({
      packageName: "demo",
      downloads: null,
      start: "2026-08-21",
      end: "2026-08-27",
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/2026-08-21:2026-08-27/demo");
  });

  it("rejects impossible dates instead of rolling them over", async () => {
    const client = new NpmRegistryClient({ fetch: async () => Response.json({ downloads: 1 }) });
    await expect(client.getWeeklyDownloads("demo", "2026-02-31")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
