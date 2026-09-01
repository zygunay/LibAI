import { describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  MemoryCache,
  RateBudget,
  RedisCache,
  TTL_MS,
  cacheKey,
  cached,
  collectPartial,
  shouldNegativeCache,
  withRetry,
} from "./index.js";

describe("cache and resilience", () => {
  it("builds deterministic credential-free keys", () => {
    expect(cacheKey("github", "metadata", { repo: "Tool", owner: "Acme" })).toBe(
      "libai:v1:github:metadata:owner=acme&repo=tool",
    );
  });
  it("shares the cache contract across memory and Redis ports", async () => {
    let now = 0;
    const memory = new MemoryCache(() => now);
    await memory.set("x", { ok: true }, 10);
    expect(await memory.get("x")).toEqual({ ok: true });
    now = 10;
    expect(await memory.get("x")).toBeUndefined();
    const values = new Map<string, string>();
    const redis = new RedisCache({
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
      del: async (key) => {
        values.delete(key);
      },
    });
    await redis.set("x", 2, TTL_MS.metadata);
    expect(await redis.get("x")).toBe(2);
    await redis.delete("x");
    expect(await redis.get("x")).toBeUndefined();
  });
  it("only negative-caches permanent misses", () => {
    expect(shouldNegativeCache({ code: "NOT_FOUND", retryable: false })).toBe(true);
    expect(shouldNegativeCache({ code: "NETWORK", retryable: true })).toBe(false);
  });
  it("coalesces concurrent misses and serves later cache hits", async () => {
    const cache = new MemoryCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      await Promise.resolve();
      return { value: 1 };
    };
    await Promise.all(Array.from({ length: 50 }, () => cached(cache, "same", 1000, load)));
    await cached(cache, "same", 1000, load);
    expect(calls).toBe(1);
  });
  it("retries retryable failures with bounded exponential backoff and jitter", async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error("temporary"), { retryable: true });
        return "ok";
      },
      {
        attempts: 3,
        timeoutMs: 100,
        baseDelayMs: 10,
        jitter: (delay) => delay + 1,
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    );
    expect(result).toBe("ok");
    expect(delays).toEqual([11, 21]);
  });
  it("protects the upstream reserve before exhaustion", () => {
    const budget = new RateBudget(5, 2);
    expect(budget.consume(3)).toBe(true);
    expect(budget.consume()).toBe(false);
    expect(budget.snapshot()).toMatchObject({ remaining: 2, healthy: false });
  });
  it("moves circuit closed→open→half-open→closed", async () => {
    let now = 0;
    const breaker = new CircuitBreaker(2, 100, () => now);
    const fail = async () => {
      throw new Error("bad");
    };
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.state()).toBe("open");
    await expect(breaker.execute(async () => "x")).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
    now = 100;
    expect(breaker.state()).toBe("half-open");
    await expect(breaker.execute(async () => "ok")).resolves.toBe("ok");
    expect(breaker.state()).toBe("closed");
  });
  it("returns explained partial results when one source fails", async () => {
    const result = await collectPartial({
      npm: async () => ["x"],
      github: async () => {
        throw Object.assign(new Error("limit"), { code: "RATE_LIMITED" });
      },
    });
    expect(result).toMatchObject({
      status: "partial",
      data: { npm: ["x"] },
      sources: { github: { health: "rate-limited", error: "limit" } },
    });
  });
  it("meets the fault-injection call budget under concurrent cache load", async () => {
    const upstream = vi.fn(async () => "payload");
    const cache = new MemoryCache();
    const results = await Promise.all(
      Array.from({ length: 200 }, () => cached(cache, "load", 1000, upstream)),
    );
    expect(results).toHaveLength(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
