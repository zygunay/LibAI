import { describe, expect, it } from "vitest";
import {
  optimisticFeedback,
  parseSharedQuery,
  recommendationCards,
  searchRecommendations,
  shareUrl,
  submitIntentCorrection,
  toggleComparison,
} from "./product.js";
describe("web product state", () => {
  it("round-trips a shareable query", () => {
    const url = shareUrl("https://libai.example/", "Node logger");
    expect(parseSharedQuery(new URL(url).search)).toBe("Node logger");
  });
  it("limits comparison to 2–5 selectable candidates", () => {
    let selected: readonly string[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f"]) selected = toggleComparison(selected, id);
    expect(selected).toEqual(["a", "b", "c", "d", "e"]);
    expect(toggleComparison(selected, "c")).not.toContain("c");
  });
  it("applies feedback optimistically and idempotently", () => {
    const first = optimisticFeedback({}, "a", "helpful");
    expect(optimisticFeedback(first, "a", "helpful")).toEqual(first);
  });
  it("sends corrected intent to the search API", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const intent = {
      schemaVersion: "1" as const,
      query: "Node logger",
      normalizedQuery: "node logger",
      ecosystem: "npm" as const,
      language: "en" as const,
      taskType: "observe" as const,
      task: "logging",
      constraints: [],
      clarificationNeeded: false,
      missingFields: [],
      ambiguities: [],
    };
    await submitIntentCorrection(
      intent,
      "structured logging",
      async (input, init) => {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return Response.json({ status: "complete" });
      },
      "https://api.example",
    );
    expect(calls).toEqual([
      {
        url: "https://api.example/v1/search",
        body: expect.objectContaining({ task: "structured logging" }),
      },
    ]);
  });
  it("maps live API recommendations to cards instead of demo fixtures", async () => {
    const intent = {
      schemaVersion: "1" as const,
      query: "PDF parser",
      normalizedQuery: "pdf parser",
      ecosystem: "npm" as const,
      language: "en" as const,
      taskType: "transform" as const,
      task: "transform files",
      constraints: [],
      clarificationNeeded: false,
      missingFields: [],
      ambiguities: [],
    };
    const snapshot = await searchRecommendations(
      intent,
      async () =>
        Response.json({
          id: "rec-1",
          requestId: "req-1",
          status: "complete",
          warnings: [],
          recommendations: [
            {
              candidateId: "npm:pdf-lib",
              rank: 1,
              summary: "Live result",
              generatedBy: "ollama",
              score: { total: 88, confidence: 0.9, components: { taskFit: 90 } },
              details: {
                packageName: "pdf-lib",
                version: "1.0.0",
                description: "PDF tools",
                repositoryUrl: "https://github.com/Hopding/pdf-lib",
                weeklyDownloads: 1000,
                stars: 7000,
                license: "MIT",
                freshness: "fresh",
                risk: "low",
                evidence: ["npm live"],
              },
            },
          ],
        }),
      "https://api.example",
    );
    expect(recommendationCards(snapshot)).toEqual([
      expect.objectContaining({ name: "pdf-lib", summary: "Live result", generatedBy: "ollama" }),
    ]);
  });
});
