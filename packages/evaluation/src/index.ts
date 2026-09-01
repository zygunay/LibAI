export type Judgment = "relevant" | "conditional" | "irrelevant";
export type FailureCategory =
  | "retrieval"
  | "identity"
  | "filter"
  | "ranking"
  | "freshness"
  | "adversarial";
export function precisionAtK(
  actual: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  validateK(k);
  const slice = actual.slice(0, k);
  return slice.length ? slice.filter((id) => relevant.has(id)).length / slice.length : 0;
}
export function recallAtK(
  actual: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  validateK(k);
  return relevant.size
    ? actual.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size
    : 0;
}
export function reciprocalRank(actual: readonly string[], relevant: ReadonlySet<string>): number {
  const index = actual.findIndex((id) => relevant.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}
export function ndcgAtK(
  actual: readonly string[],
  gains: Readonly<Record<string, number>>,
  k: number,
): number {
  validateK(k);
  const dcg = actual
    .slice(0, k)
    .reduce((sum, id, index) => sum + (gains[id] ?? 0) / Math.log2(index + 2), 0);
  const ideal = Object.values(gains)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}
export function classifyFailure(
  input: Readonly<{
    found: boolean;
    identityCorrect: boolean;
    filtered: boolean;
    stale: boolean;
    adversarial: boolean;
  }>,
): FailureCategory | null {
  if (input.adversarial) return "adversarial";
  if (!input.found) return "retrieval";
  if (!input.identityCorrect) return "identity";
  if (input.filtered) return "filter";
  if (input.stale) return "freshness";
  return null;
}
export function assertQualityGate(
  metrics: Readonly<{ precisionAt5: number; recallAt10: number; ndcgAt10: number; mrr: number }>,
  thresholds = { precisionAt5: 0.6, recallAt10: 0.6, ndcgAt10: 0.65, mrr: 0.65 },
): void {
  for (const key of Object.keys(thresholds) as (keyof typeof thresholds)[])
    if (metrics[key] < thresholds[key])
      throw new Error(`Quality regression: ${key}=${metrics[key]} < ${thresholds[key]}`);
}
function validateK(k: number): void {
  if (!Number.isInteger(k) || k < 1) throw new Error("k must be a positive integer");
}
