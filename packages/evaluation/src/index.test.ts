import { describe, expect, it } from "vitest";
import {
  assertQualityGate,
  classifyFailure,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from "./index.js";
describe("ranking evaluation", () => {
  const relevant = new Set(["a", "c"]);
  const actual = ["a", "b", "c"];
  it("computes Precision@K and Recall@K", () => {
    expect(precisionAtK(actual, relevant, 2)).toBe(0.5);
    expect(recallAtK(actual, relevant, 2)).toBe(0.5);
  });
  it("computes NDCG and MRR from reference rankings", () => {
    expect(ndcgAtK(actual, { a: 3, c: 2 }, 3)).toBeGreaterThan(0.9);
    expect(reciprocalRank(["b", "c"], relevant)).toBe(0.5);
  });
  it("assigns one primary failure category", () => {
    expect(
      classifyFailure({
        found: false,
        identityCorrect: false,
        filtered: false,
        stale: false,
        adversarial: false,
      }),
    ).toBe("retrieval");
    expect(
      classifyFailure({
        found: true,
        identityCorrect: true,
        filtered: false,
        stale: false,
        adversarial: false,
      }),
    ).toBeNull();
  });
  it("fails regressions below a versioned quality threshold", () => {
    expect(() =>
      assertQualityGate({ precisionAt5: 0.5, recallAt10: 1, ndcgAt10: 1, mrr: 1 }),
    ).toThrow("Quality regression");
    expect(() =>
      assertQualityGate({ precisionAt5: 1, recallAt10: 1, ndcgAt10: 1, mrr: 1 }),
    ).not.toThrow();
  });
});
