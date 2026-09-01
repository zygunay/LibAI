import { describe, expect, it } from "vitest";

import type { GitHubAdapter } from "./adapter.js";
import { GitHubError } from "./adapter.js";

const fake: GitHubAdapter = {
  async get<T>(path: string) {
    return {
      data: { path } as T,
      sourceUrl: `https://api.github.com${path}`,
      fetchedAt: "2026-08-28T00:00:00.000Z",
      rateLimit: { limit: 60, remaining: 59, resetAt: null },
    };
  },
};

describe("GitHub adapter contract", () => {
  it("can be implemented by a deterministic fake", async () => {
    await expect(fake.get<{ path: string }>("/rate_limit")).resolves.toMatchObject({
      data: { path: "/rate_limit" },
      rateLimit: { remaining: 59 },
    });
  });

  it("uses stable typed errors without carrying credentials", () => {
    const error = new GitHubError("RATE_LIMITED", "GitHub rate limit reached", {
      retryable: true,
      status: 403,
    });
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryable: true, status: 403 });
    expect(JSON.stringify(error)).not.toContain("token");
  });
});
