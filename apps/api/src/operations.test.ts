import { describe, expect, it } from "vitest";
import {
  MetricRegistry,
  SlidingWindowRateLimiter,
  evaluateAvailabilityAlert,
  retentionCutoff,
} from "./operations.js";
describe("production operations", () => {
  it("limits abuse and recovers after the window", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(2, 100, () => now);
    expect(limiter.allow("ip").allowed).toBe(true);
    expect(limiter.allow("ip").allowed).toBe(true);
    expect(limiter.allow("ip")).toMatchObject({ allowed: false, retryAfterMs: 100 });
    now = 100;
    expect(limiter.allow("ip").allowed).toBe(true);
  });
  it("renders low-cardinality metrics deterministically", () => {
    const metrics = new MetricRegistry();
    metrics.increment("libai_requests_total", { route: "recommendations", status: "200" });
    expect(metrics.render()).toBe("libai_requests_totalroute=recommendations,status=200 1");
  });
  it("computes a deterministic retention cutoff", () => {
    expect(retentionCutoff(new Date("2026-08-28T00:00:00Z"), 30)).toBe("2026-07-29T00:00:00.000Z");
  });
  it("fires and resolves the beta availability alarm", () => {
    expect(evaluateAvailabilityAlert(97, 100)).toBe("firing");
    expect(evaluateAvailabilityAlert(99, 100)).toBe("resolved");
  });
});
