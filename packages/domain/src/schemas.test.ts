import { describe, expect, it } from "vitest";

import {
  CandidateValidator,
  EvidenceValidator,
  RecommendationValidator,
  ScoreBreakdownValidator,
  SearchIntentValidator,
} from "./schemas.js";

const evidence = {
  id: "npm:demo:downloads",
  source: "npm",
  field: "weeklyDownloads",
  value: 42,
  sourceUrl: "https://registry.npmjs.org/demo",
  fetchedAt: "2026-08-28T00:00:00.000Z",
};

const score = {
  version: "score-v1",
  total: 82,
  components: { taskFit: 90, maintenance: 74 },
  confidence: 0.8,
  evidenceIds: [evidence.id],
};

describe("domain runtime schemas", () => {
  it("accepts valid pipeline fixtures", () => {
    expect(
      SearchIntentValidator.Check({
        schemaVersion: "1",
        query: "Node için logger",
        normalizedQuery: "node için logger",
        ecosystem: "npm",
        language: "tr",
        taskType: "observe",
        task: "structured logging",
        constraints: [{ kind: "runtime", operator: "required", value: "node" }],
        clarificationNeeded: false,
        missingFields: [],
        ambiguities: [],
      }),
    ).toBe(true);
    expect(EvidenceValidator.Check(evidence)).toBe(true);
    expect(
      CandidateValidator.Check({
        id: "npm:demo",
        packageName: "demo",
        evidence: [evidence],
        warnings: [],
      }),
    ).toBe(true);
    expect(ScoreBreakdownValidator.Check(score)).toBe(true);
    expect(
      RecommendationValidator.Check({
        candidateId: "npm:demo",
        rank: 1,
        score,
        summary: "Doğrulanmış aday",
        strengths: ["Bakım sinyali var"],
        tradeoffs: [],
        risks: [],
        evidenceIds: [evidence.id],
      }),
    ).toBe(true);
  });

  it("rejects missing provenance, invalid scores and unknown properties", () => {
    expect(EvidenceValidator.Check({ ...evidence, fetchedAt: undefined })).toBe(false);
    expect(ScoreBreakdownValidator.Check({ ...score, confidence: 1.2 })).toBe(false);
    expect(
      CandidateValidator.Check({
        id: "npm:demo",
        packageName: "demo",
        evidence: [],
        warnings: [],
        invented: true,
      }),
    ).toBe(false);
  });

  it("rejects incomplete and unsupported intent fixtures", () => {
    const base = {
      schemaVersion: "1",
      query: "Node için logger",
      normalizedQuery: "node için logger",
      ecosystem: "npm",
      language: "tr",
      taskType: "observe",
      task: "structured logging",
      constraints: [],
      clarificationNeeded: false,
      missingFields: [],
      ambiguities: [],
    };
    expect(SearchIntentValidator.Check(base)).toBe(true);
    expect(SearchIntentValidator.Check({ ...base, taskType: "chat" })).toBe(false);
    expect(SearchIntentValidator.Check({ ...base, missingFields: ["budget"] })).toBe(false);
    expect(SearchIntentValidator.Check({ ...base, schemaVersion: "2" })).toBe(false);
  });
});
