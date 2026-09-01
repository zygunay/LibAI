import type { SearchIntent } from "@libai/domain";
import { rankCandidates, type RankingCandidate, type ScoreExplanation } from "@libai/ranking";

export type PipelineState =
  | "received"
  | "discovering"
  | "normalizing"
  | "ranking"
  | "explaining"
  | "complete"
  | "partial"
  | "failed";
const TRANSITIONS: Readonly<Record<PipelineState, readonly PipelineState[]>> = {
  received: ["discovering", "failed"],
  discovering: ["normalizing", "partial", "failed"],
  normalizing: ["ranking", "failed"],
  ranking: ["explaining", "complete", "partial", "failed"],
  explaining: ["complete", "partial", "failed"],
  complete: [],
  partial: [],
  failed: [],
};
export type PipelineEvent = Readonly<{ state: PipelineState; occurredAt: string; detail?: string }>;
export function transition(
  events: readonly PipelineEvent[],
  next: PipelineState,
  now: Date,
  detail?: string,
): readonly PipelineEvent[] {
  const current = events.at(-1)?.state;
  if (current && !TRANSITIONS[current].includes(next))
    throw new Error(`Invalid pipeline transition: ${current} -> ${next}`);
  return [...events, { state: next, occurredAt: now.toISOString(), ...(detail ? { detail } : {}) }];
}

export type RecommendationItem = Readonly<{
  candidateId: string;
  rank: number;
  score: ScoreExplanation;
  summary: string;
  generatedBy: "ollama" | "deterministic-fallback";
  details?: DiscoveryCandidateDetails;
}>;
export type RecommendationSnapshot = Readonly<{
  id: string;
  requestId: string;
  intent: SearchIntent;
  status: "complete" | "partial";
  recommendations: readonly RecommendationItem[];
  events: readonly PipelineEvent[];
  createdAt: string;
  warnings: readonly string[];
}>;
export type Feedback = Readonly<{
  snapshotId: string;
  candidateId: string;
  value: "helpful" | "not-helpful";
  idempotencyKey: string;
  createdAt: string;
}>;
export interface SnapshotStore {
  findByRequestId(requestId: string): Promise<RecommendationSnapshot | undefined>;
  save(snapshot: RecommendationSnapshot): Promise<void>;
  get(id: string): Promise<RecommendationSnapshot | undefined>;
  saveFeedback(feedback: Feedback): Promise<"created" | "duplicate">;
  purgeBefore(cutoff: string): Promise<number>;
}
export class MemorySnapshotStore implements SnapshotStore {
  private snapshots = new Map<string, RecommendationSnapshot>();
  private requestIds = new Map<string, string>();
  private feedback = new Map<string, Feedback>();
  async findByRequestId(requestId: string): Promise<RecommendationSnapshot | undefined> {
    const id = this.requestIds.get(requestId);
    return id ? this.snapshots.get(id) : undefined;
  }
  async save(snapshot: RecommendationSnapshot): Promise<void> {
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
    this.requestIds.set(snapshot.requestId, snapshot.id);
  }
  async get(id: string): Promise<RecommendationSnapshot | undefined> {
    const value = this.snapshots.get(id);
    return value ? structuredClone(value) : undefined;
  }
  async saveFeedback(feedback: Feedback): Promise<"created" | "duplicate"> {
    if (this.feedback.has(feedback.idempotencyKey)) return "duplicate";
    this.feedback.set(feedback.idempotencyKey, feedback);
    return "created";
  }
  async purgeBefore(cutoff: string): Promise<number> {
    if (Number.isNaN(Date.parse(cutoff))) throw new Error("Invalid retention cutoff");
    const removed = [...this.snapshots.values()].filter((snapshot) => snapshot.createdAt < cutoff);
    for (const snapshot of removed) {
      this.snapshots.delete(snapshot.id);
      this.requestIds.delete(snapshot.requestId);
      for (const [key, item] of this.feedback)
        if (item.snapshotId === snapshot.id) this.feedback.delete(key);
    }
    return removed.length;
  }
}
export type DiscoveryCandidateDetails = Readonly<{
  packageName: string;
  version: string | null;
  description: string | null;
  repositoryUrl: string | null;
  weeklyDownloads: number | null;
  stars: number | null;
  license: string | null;
  freshness: "fresh" | "stale" | "unknown";
  risk: "low" | "medium" | "high" | "unknown";
  evidence: readonly string[];
}>;
export type DiscoveryCandidate = RankingCandidate &
  Readonly<{
    details?: DiscoveryCandidateDetails;
    queryLanguage?: SearchIntent["language"];
  }>;
export type ExplanationResult = Readonly<{
  text: string;
  generatedBy: "ollama" | "deterministic-fallback";
}>;
export type DiscoveryResult = Readonly<{
  candidates: readonly DiscoveryCandidate[];
  warnings?: readonly string[];
}>;
export class RecommendationService {
  constructor(
    private readonly dependencies: Readonly<{
      discover(intent: SearchIntent): Promise<DiscoveryResult>;
      store: SnapshotStore;
      explain?: (
        candidate: DiscoveryCandidate,
        score: ScoreExplanation,
      ) => Promise<string | ExplanationResult>;
      now?: () => Date;
    }>,
  ) {}
  async recommend(intent: SearchIntent, requestId: string): Promise<RecommendationSnapshot> {
    validateRequestId(requestId);
    const existing = await this.dependencies.store.findByRequestId(requestId);
    if (existing) return existing;
    const now = this.dependencies.now ?? (() => new Date());
    let events: readonly PipelineEvent[] = transition([], "received", now());
    events = transition(events, "discovering", now());
    const discovery = await this.dependencies.discover(intent);
    events = transition(events, "normalizing", now());
    events = transition(events, "ranking", now());
    const ranked = rankCandidates(discovery.candidates);
    const items: RecommendationItem[] = [];
    if (this.dependencies.explain) events = transition(events, "explaining", now());
    for (const [index, item] of ranked.entries()) {
      const candidate = item.candidate as DiscoveryCandidate;
      const explanation = this.dependencies.explain
        ? await this.dependencies.explain(candidate, item.score)
        : `${candidate.id} scored ${item.score.total}/100.`;
      const summary = typeof explanation === "string" ? explanation : explanation.text;
      const generatedBy =
        typeof explanation === "string" ? "deterministic-fallback" : explanation.generatedBy;
      items.push({
        candidateId: candidate.id,
        rank: index + 1,
        score: item.score,
        summary,
        generatedBy,
        ...(candidate.details ? { details: candidate.details } : {}),
      });
    }
    const warnings = discovery.warnings ?? [];
    const status = warnings.length ? "partial" : "complete";
    events = transition(events, status, now());
    const createdAt = now().toISOString();
    const snapshot: RecommendationSnapshot = {
      id: `rec_${fingerprint(`${requestId}|${createdAt}`)}`,
      requestId,
      intent: structuredClone(intent),
      status,
      recommendations: items,
      events,
      createdAt,
      warnings,
    };
    await this.dependencies.store.save(snapshot);
    return snapshot;
  }
}
export function validatePayloadSize(value: unknown, maxBytes = 64 * 1024): void {
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes)
    throw Object.assign(new Error("Payload is too large"), { code: "PAYLOAD_TOO_LARGE" });
}
export const MIGRATION_UP = `CREATE TABLE recommendation_snapshots (id text PRIMARY KEY, request_id text UNIQUE NOT NULL, intent jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL); CREATE TABLE feedback (idempotency_key text PRIMARY KEY, snapshot_id text NOT NULL REFERENCES recommendation_snapshots(id), candidate_id text NOT NULL, value text NOT NULL, created_at timestamptz NOT NULL);`;
export const MIGRATION_DOWN = `DROP TABLE IF EXISTS feedback; DROP TABLE IF EXISTS recommendation_snapshots;`;
function validateRequestId(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(value)) throw new Error("Invalid request ID");
}
function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
