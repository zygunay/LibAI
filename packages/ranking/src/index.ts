export const SCORE_VERSION = "deterministic-v1";
export type RankingCandidate = Readonly<{
  id: string;
  evidenceIds: readonly string[];
  taskFit?: number;
  daysSinceCommit?: number;
  runtimeCompatible?: boolean | "unknown";
  weeklyDownloads?: number;
  stars?: number;
  readmeBytes?: number;
  hasExamples?: boolean;
  licenseCompatible?: boolean | "unknown";
  deprecated?: boolean;
  archived?: boolean;
  securityRisk?: "none" | "low" | "high" | "unknown";
}>;
export type ScoreExplanation = Readonly<{
  scoreVersion: typeof SCORE_VERSION;
  total: number;
  confidence: number;
  vetoes: readonly string[];
  warnings: readonly string[];
  components: Readonly<Record<string, number>>;
  evidenceIds: readonly string[];
}>;

const WEIGHTS = {
  taskFit: 0.3,
  maintenance: 0.2,
  compatibility: 0.15,
  adoption: 0.1,
  documentation: 0.1,
  license: 0.1,
  risk: 0.05,
} as const;

export function hardFilters(candidate: RankingCandidate): readonly string[] {
  return [
    candidate.deprecated ? "deprecated" : null,
    candidate.archived ? "archived" : null,
    candidate.runtimeCompatible === false ? "runtime-incompatible" : null,
    candidate.licenseCompatible === false ? "license-incompatible" : null,
  ].filter((item): item is string => item !== null);
}
export function maintenanceScore(days: number | undefined): number {
  return days === undefined ? 50 : clamp(100 * Math.exp(-days / 365));
}
export function compatibilityScore(value: boolean | "unknown" | undefined): number {
  return value === true ? 100 : value === false ? 0 : 50;
}
export function adoptionScore(downloads = 0, stars = 0): number {
  return clamp((60 * Math.log10(downloads + 1)) / 7 + (40 * Math.log10(stars + 1)) / 6);
}
export function documentationScore(
  bytes: number | undefined,
  examples: boolean | undefined,
): number {
  if (bytes === undefined) return 40;
  return clamp(Math.min(80, Math.log10(bytes + 1) * 20) + (examples ? 20 : 0));
}
export function licenseScore(value: boolean | "unknown" | undefined): number {
  return value === true ? 100 : value === false ? 0 : 40;
}
export function riskScore(value: RankingCandidate["securityRisk"]): number {
  return value === "none" ? 100 : value === "low" ? 70 : value === "high" ? 0 : 45;
}
export function confidence(candidate: RankingCandidate): number {
  const values = [
    candidate.taskFit,
    candidate.daysSinceCommit,
    candidate.runtimeCompatible,
    candidate.weeklyDownloads,
    candidate.readmeBytes,
    candidate.licenseCompatible,
    candidate.securityRisk,
  ];
  return Number(
    (
      values.filter((value) => value !== undefined && value !== "unknown").length / values.length
    ).toFixed(3),
  );
}
export function scoreCandidate(candidate: RankingCandidate): ScoreExplanation {
  const vetoes = hardFilters(candidate);
  const components = {
    taskFit: clamp(candidate.taskFit ?? 50),
    maintenance: maintenanceScore(candidate.daysSinceCommit),
    compatibility: compatibilityScore(candidate.runtimeCompatible),
    adoption: adoptionScore(candidate.weeklyDownloads, candidate.stars),
    documentation: documentationScore(candidate.readmeBytes, candidate.hasExamples),
    license: licenseScore(candidate.licenseCompatible),
    risk: riskScore(candidate.securityRisk),
  };
  const weighted = Object.entries(WEIGHTS).reduce(
    (total, [key, weight]) => total + components[key as keyof typeof components] * weight,
    0,
  );
  const warnings = [
    candidate.securityRisk === "high" ? "high-security-risk" : null,
    candidate.securityRisk === "unknown" ? "security-unknown" : null,
    candidate.licenseCompatible === "unknown" ? "license-unknown" : null,
  ].filter((item): item is string => item !== null);
  return {
    scoreVersion: SCORE_VERSION,
    total: vetoes.length ? 0 : round(weighted),
    confidence: confidence(candidate),
    vetoes,
    warnings,
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [key, round(value)]),
    ),
    evidenceIds: [...new Set(candidate.evidenceIds)].sort(),
  };
}
export function rankCandidates(
  candidates: readonly RankingCandidate[],
): readonly Readonly<{ candidate: RankingCandidate; score: ScoreExplanation }>[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
    .sort(
      (a, b) =>
        b.score.total - a.score.total ||
        b.score.confidence - a.score.confidence ||
        a.candidate.id.localeCompare(b.candidate.id),
    );
}
export function diversify(
  ranked: ReturnType<typeof rankCandidates>,
  limit: number,
): ReturnType<typeof rankCandidates> {
  const selected: (typeof ranked)[number][] = [];
  const remaining = [...ranked];
  while (selected.length < limit && remaining.length) {
    const next = remaining.splice(
      selected.length === 1 && remaining.length > 1 ? Math.min(1, remaining.length - 1) : 0,
      1,
    )[0];
    if (next) selected.push(next);
  }
  return selected;
}
function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
