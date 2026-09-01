import { describe, expect, it, vi } from "vitest";

import { GitHubClient } from "./client.js";

describe("GitHub auth client", () => {
  it("works without a token and exposes anonymous rate-limit metadata", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { resources: {} },
        {
          headers: {
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "59",
            "x-ratelimit-reset": "1787875200",
          },
        },
      ),
    );
    const client = new GitHubClient({
      fetch: fetcher,
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });

    const response = await client.get<{ resources: object }>("/rate_limit");
    const init = fetcher.mock.calls[0]?.[1];
    expect(client.authenticated).toBe(false);
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(response).toMatchObject({
      sourceUrl: "https://api.github.com/rate_limit",
      fetchedAt: "2026-08-28T00:00:00.000Z",
      rateLimit: { limit: 60, remaining: 59 },
    });
  });

  it("adds a server token only to the authorization header", async () => {
    const secret = "github-secret-value";
    const fetcher = vi.fn(async () => Response.json({ login: "libai" }));
    const client = new GitHubClient({ token: `  ${secret}  `, fetch: fetcher });

    const response = await client.get<{ login: string }>("/user", { query: { page: 2 } });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(client.authenticated).toBe(true);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
    expect(String(url)).toBe("https://api.github.com/user?page=2");
    expect(JSON.stringify(response)).not.toContain(secret);
  });

  it("maps authentication and rate-limit responses to stable errors", async () => {
    const unauthorized = new GitHubClient({
      token: "secret",
      fetch: async () => new Response(null, { status: 401 }),
    });
    await expect(unauthorized.get("/user")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      retryable: false,
    });

    const limited = new GitHubClient({
      fetch: async () =>
        new Response(null, {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    });
    await expect(limited.get("/search/repositories")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      rateLimit: { remaining: 0 },
    });
  });

  it("rejects unsafe paths and credential control characters before fetching", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    const client = new GitHubClient({ fetch: fetcher });
    await expect(client.get("https://example.com/steal")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => new GitHubClient({ token: "secret\nvalue" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIG" }),
    );
  });
});
