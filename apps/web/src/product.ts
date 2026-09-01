import type { SearchIntent } from "@libai/domain";

export type ResultState = "loading" | "complete" | "partial" | "empty" | "error" | "slow";
export type RecommendationCard = Readonly<{
  id: string;
  name: string;
  version: string | null;
  repositoryUrl: string | null;
  summary: string;
  generatedBy: "ollama" | "deterministic-fallback";
  score: number;
  confidence: number;
  weeklyDownloads: string;
  stars: string;
  freshness: "fresh" | "stale" | "unknown";
  risk: "low" | "medium" | "high" | "unknown";
  license: string;
  evidence: readonly string[];
  components: Readonly<Record<string, number>>;
}>;

export type RecommendationSnapshot = Readonly<{
  id: string;
  requestId: string;
  status: "complete" | "partial";
  recommendations: readonly Readonly<{
    candidateId: string;
    rank: number;
    summary: string;
    generatedBy: "ollama" | "deterministic-fallback";
    score: Readonly<{
      total: number;
      confidence: number;
      components: Readonly<Record<string, number>>;
    }>;
    details?: Readonly<{
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
  }>[];
  warnings: readonly string[];
}>;

export const pipelineSteps = [
  "Request understood",
  "npm searched",
  "GitHub verified",
  "Evidence consolidated",
  "Candidates ranked",
] as const;

export function parseSharedQuery(search: string): string | null {
  const value = new URLSearchParams(search).get("q")?.trim();
  return value && value.length >= 3 && value.length <= 2_000 ? value : null;
}

export function shareUrl(origin: string, query: string): string {
  const url = new URL(origin);
  url.searchParams.set("q", query.trim());
  return url.toString();
}

export function toggleComparison(current: readonly string[], id: string): readonly string[] {
  if (current.includes(id)) return current.filter((item) => item !== id);
  return current.length >= 5 ? current : [...current, id];
}

export function optimisticFeedback(
  current: Readonly<Record<string, "helpful" | "not-helpful">>,
  id: string,
  value: "helpful" | "not-helpful",
): Readonly<Record<string, "helpful" | "not-helpful">> {
  return { ...current, [id]: value };
}

export async function searchRecommendations(
  intent: SearchIntent,
  fetcher: typeof fetch = fetch,
  apiBaseUrl = "http://127.0.0.1:3000",
): Promise<RecommendationSnapshot> {
  const response = await fetcher(new URL("/v1/search", apiBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(intent),
  });
  if (!response.ok) throw new Error(`Recommendation search failed with HTTP ${response.status}`);
  return (await response.json()) as RecommendationSnapshot;
}

export async function submitIntentCorrection(
  intent: SearchIntent,
  task: string,
  fetcher: typeof fetch = fetch,
  apiBaseUrl = "http://127.0.0.1:3000",
): Promise<RecommendationSnapshot> {
  return searchRecommendations({ ...intent, task: task.trim() }, fetcher, apiBaseUrl);
}

export function recommendationCards(
  snapshot: RecommendationSnapshot,
): readonly RecommendationCard[] {
  return snapshot.recommendations.map((item) => ({
    id: item.candidateId,
    name: item.details?.packageName ?? item.candidateId.replace(/^npm:/u, ""),
    version: item.details?.version ?? null,
    repositoryUrl: item.details?.repositoryUrl ?? null,
    summary: item.summary,
    generatedBy: item.generatedBy,
    score: item.score.total,
    confidence: item.score.confidence,
    weeklyDownloads: formatMetric(item.details?.weeklyDownloads),
    stars: formatMetric(item.details?.stars),
    freshness: item.details?.freshness ?? "unknown",
    risk: item.details?.risk ?? "unknown",
    license: item.details?.license ?? "Unknown",
    evidence: item.details?.evidence ?? [],
    components: item.score.components,
  }));
}

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}
