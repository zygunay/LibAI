import { describe, expect, it } from "vitest";
import {
  adoptionScore,
  confidence,
  diversify,
  maintenanceScore,
  rankCandidates,
  scoreCandidate,
} from "./index.js";
const base = {
  id: "a",
  evidenceIds: ["ev1"],
  taskFit: 90,
  daysSinceCommit: 5,
  runtimeCompatible: true,
  weeklyDownloads: 1000,
  stars: 100,
  readmeBytes: 5000,
  hasExamples: true,
  licenseCompatible: true,
  securityRisk: "none" as const,
};
describe("deterministic ranking", () => {
  it("vetoes deprecated and incompatible candidates", () => {
    expect(scoreCandidate({ ...base, deprecated: true }).total).toBe(0);
    expect(scoreCandidate({ ...base, runtimeCompatible: false }).vetoes).toContain(
      "runtime-incompatible",
    );
  });
  it("decays maintenance and log-normalizes adoption without overflow", () => {
    expect(maintenanceScore(0)).toBe(100);
    expect(maintenanceScore(730)).toBeLessThan(15);
    expect(adoptionScore(Number.MAX_SAFE_INTEGER, 1e9)).toBe(100);
  });
  it("scores compatibility, docs, license and risk with evidence-linked explanation", () => {
    expect(scoreCandidate(base)).toMatchObject({
      scoreVersion: "deterministic-v1",
      warnings: [],
      evidenceIds: ["ev1"],
      components: { compatibility: 100, license: 100, risk: 100 },
    });
  });
  it("reduces confidence as evidence becomes missing", () => {
    expect(confidence(base)).toBeGreaterThan(confidence({ id: "b", evidenceIds: [] }));
  });
  it("is repeatable and stars alone do not dominate task fit", () => {
    const small = { ...base, id: "small", weeklyDownloads: 10, stars: 2 };
    const popularWrong = { ...base, id: "popular", taskFit: 0, weeklyDownloads: 1e9, stars: 1e7 };
    expect(rankCandidates([popularWrong, small])[0]?.candidate.id).toBe("small");
    expect(rankCandidates([small, popularWrong])).toEqual(rankCandidates([small, popularWrong]));
  });
  it("provides a stable diversity pass", () => {
    const ranked = rankCandidates([
      base,
      { ...base, id: "b", taskFit: 89 },
      { ...base, id: "c", taskFit: 88 },
    ]);
    expect(diversify(ranked, 2)).toHaveLength(2);
  });
});
