import type { SearchIntent } from "@libai/domain";
import { describe, expect, it } from "vitest";
import {
  MIGRATION_DOWN,
  MIGRATION_UP,
  MemorySnapshotStore,
  RecommendationService,
  transition,
  validatePayloadSize,
} from "./index.js";
const intent: SearchIntent = {
  schemaVersion: "1",
  query: "Node için logger",
  normalizedQuery: "node için logger",
  ecosystem: "npm",
  language: "tr",
  taskType: "observe",
  task: "logging",
  constraints: [],
  clarificationNeeded: false,
  missingFields: [],
  ambiguities: [],
};
describe("recommendation application", () => {
  it("enforces valid pipeline transitions", () => {
    const events = transition([], "received", new Date(0));
    expect(() => transition(events, "ranking", new Date(1))).toThrow("Invalid pipeline transition");
  });
  it("orchestrates and round-trips snapshots idempotently", async () => {
    const store = new MemorySnapshotStore();
    let tick = 0;
    const service = new RecommendationService({
      store,
      now: () => new Date(tick++),
      discover: async () => ({ candidates: [{ id: "pino", evidenceIds: ["ev1"], taskFit: 95 }] }),
      explain: async (candidate) => `${candidate.id} is grounded.`,
    });
    const result = await service.recommend(intent, "req-1");
    expect(result).toMatchObject({
      status: "complete",
      recommendations: [
        {
          candidateId: "pino",
          rank: 1,
          summary: "pino is grounded.",
          score: { evidenceIds: ["ev1"] },
        },
      ],
    });
    expect(await store.get(result.id)).toEqual(result);
    expect(await service.recommend(intent, "req-1")).toEqual(result);
  });
  it("returns partial results with source warnings", async () => {
    const service = new RecommendationService({
      store: new MemorySnapshotStore(),
      discover: async () => ({
        candidates: [{ id: "cached", evidenceIds: ["ev1"] }],
        warnings: ["github unavailable"],
      }),
    });
    await expect(service.recommend(intent, "req-2")).resolves.toMatchObject({
      status: "partial",
      warnings: ["github unavailable"],
    });
  });
  it("stores feedback idempotently", async () => {
    const store = new MemorySnapshotStore();
    const feedback = {
      snapshotId: "s",
      candidateId: "c",
      value: "helpful" as const,
      idempotencyKey: "key",
      createdAt: new Date(0).toISOString(),
    };
    expect(await store.saveFeedback(feedback)).toBe("created");
    expect(await store.saveFeedback(feedback)).toBe("duplicate");
  });
  it("purges expired snapshots and linked feedback", async () => {
    const store = new MemorySnapshotStore();
    const service = new RecommendationService({
      store,
      now: () => new Date("2026-01-01T00:00:00Z"),
      discover: async () => ({ candidates: [] }),
    });
    const snapshot = await service.recommend(intent, "retention-1");
    await store.saveFeedback({
      snapshotId: snapshot.id,
      candidateId: "c",
      value: "helpful",
      idempotencyKey: "retention-feedback",
      createdAt: snapshot.createdAt,
    });
    expect(await store.purgeBefore("2026-02-01T00:00:00Z")).toBe(1);
    expect(await store.get(snapshot.id)).toBeUndefined();
  });
  it("defines reversible PostgreSQL schema and input limits", () => {
    expect(MIGRATION_UP).toContain("recommendation_snapshots");
    expect(MIGRATION_DOWN).toContain("DROP TABLE");
    expect(() => validatePayloadSize("x".repeat(70_000))).toThrow("too large");
  });
});
