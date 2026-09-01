import {
  MemorySnapshotStore,
  RecommendationService,
  type DiscoveryCandidate,
  type DiscoveryResult,
  type SnapshotStore,
} from "@libai/application";
import { GitHubClient, GitHubDiscovery, type GitHubError } from "@libai/github";
import type { SearchIntent } from "@libai/domain";
import {
  buildBoundedPrompt,
  generateStructured,
  OllamaProvider,
  type ModelProvider,
} from "@libai/model";
import {
  assessPackageStatus,
  extractLicenseSignal,
  extractModuleSignals,
  extractPackageIdentity,
  extractRuntimeCompatibility,
  NpmRegistryClient,
  selectPackageVersion,
  type NpmPackument,
  type NpmRegistryAdapter,
  type NpmSearchHit,
} from "@libai/npm-registry";

const RESULT_LIMIT = 5;
const GITHUB_ENRICHMENT_LIMIT = 3;
const SEARCH_LIMIT = 8;
const MIN_RELEVANCE_SCORE = 70;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const PERMISSIVE_LICENSES = new Set(["MIT", "ISC", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE"]);

type GitHubReader = Pick<GitHubDiscovery, "repository" | "activity" | "readme">;

type CandidateAssessment = Readonly<{
  candidateId: string;
  verdict: "relevant" | "conditional" | "irrelevant";
  fit: number;
  reason: string;
}>;

type CandidateClassifier = (
  intent: SearchIntent,
  hits: readonly NpmSearchHit[],
) => Promise<Readonly<{ assessments: readonly CandidateAssessment[]; warning?: string }>>;

export type LiveServiceOptions = Readonly<{
  githubToken?: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  registry?: NpmRegistryAdapter;
  github?: GitHubReader;
  model?: ModelProvider;
  now?: () => Date;
  store?: SnapshotStore;
}>;

export function createLiveRecommendationService(
  options: LiveServiceOptions,
): RecommendationService {
  const now = options.now ?? (() => new Date());
  const registry = options.registry ?? new NpmRegistryClient({ now });
  const github =
    options.github ??
    new GitHubDiscovery(
      new GitHubClient({ now, ...(options.githubToken ? { token: options.githubToken } : {}) }),
      now,
    );
  const model =
    options.model ??
    new OllamaProvider({
      model: options.ollamaModel,
      baseUrl: options.ollamaBaseUrl,
      timeoutMs: 30_000,
    });
  const classify = createCandidateClassifier(model);
  const discover = createLiveDiscovery({ registry, github, classify, now });
  const explain = createCachedExplainer(model, now);

  return new RecommendationService({
    store: options.store ?? new MemorySnapshotStore(),
    discover,
    explain,
    now,
  });
}

function createCachedExplainer(model: ModelProvider, now: () => Date) {
  type Result = Awaited<ReturnType<typeof explainCandidate>>;
  const cache = new Map<string, { expiresAt: number; result: Result }>();
  const inFlight = new Map<string, Promise<Result>>();
  return async (candidate: DiscoveryCandidate): Promise<Result> => {
    const key = JSON.stringify({ id: candidate.id, details: candidate.details });
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now().getTime()) return cached.result;
    const active = inFlight.get(key);
    if (active) return active;
    const operation = explainCandidate(model, candidate);
    inFlight.set(key, operation);
    try {
      const result = await operation;
      cache.set(key, { expiresAt: now().getTime() + CACHE_TTL_MS, result });
      return result;
    } finally {
      inFlight.delete(key);
    }
  };
}

export function createLiveDiscovery(
  dependencies: Readonly<{
    registry: NpmRegistryAdapter;
    github: GitHubReader;
    classify?: CandidateClassifier;
    now?: () => Date;
  }>,
): (intent: SearchIntent) => Promise<DiscoveryResult> {
  const now = dependencies.now ?? (() => new Date());
  const cache = new Map<string, { expiresAt: number; result: DiscoveryResult }>();
  const inFlight = new Map<string, Promise<DiscoveryResult>>();

  return async (intent) => {
    const key = JSON.stringify({
      query: intent.normalizedQuery,
      task: intent.task,
      constraints: intent.constraints,
    });
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now().getTime()) return cached.result;
    const active = inFlight.get(key);
    if (active) return active;

    const operation = (async () => {
      const page = await dependencies.registry.search(searchText(intent), { limit: SEARCH_LIMIT });
      const warnings = new Set<string>();
      const classification = dependencies.classify
        ? await dependencies.classify(intent, page.objects.slice(0, SEARCH_LIMIT))
        : deterministicCandidateClassification(intent, page.objects.slice(0, SEARCH_LIMIT));
      if (classification.warning) warnings.add(classification.warning);
      const assessmentById = new Map(
        classification.assessments.map((assessment) => [assessment.candidateId, assessment]),
      );
      const relevantHits = page.objects
        .slice(0, SEARCH_LIMIT)
        .map((hit) => ({ hit, assessment: assessmentById.get(`npm:${hit.name}`) }))
        .filter((item): item is { hit: NpmSearchHit; assessment: CandidateAssessment } =>
          Boolean(
            item.assessment &&
              item.assessment.verdict === "relevant" &&
              item.assessment.fit >= MIN_RELEVANCE_SCORE,
          ),
        )
        .sort((left, right) => right.assessment.fit - left.assessment.fit)
        .slice(0, RESULT_LIMIT);
      const candidates = (
        await Promise.all(
          relevantHits.map(({ hit, assessment }, rankIndex) =>
            enrichCandidate(
              hit,
              rankIndex,
              assessment.fit,
              intent,
              dependencies.registry,
              dependencies.github,
              warnings,
              now,
            ),
          ),
        )
      ).filter((candidate): candidate is DiscoveryCandidate => candidate !== null);
      const result: DiscoveryResult = {
        candidates,
        ...(warnings.size ? { warnings: [...warnings] } : {}),
      };
      cache.set(key, { expiresAt: now().getTime() + CACHE_TTL_MS, result });
      return result;
    })();
    inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(key);
    }
  };
}

async function enrichCandidate(
  hit: NpmSearchHit,
  rankIndex: number,
  relevanceFit: number,
  intent: SearchIntent,
  registry: NpmRegistryAdapter,
  github: GitHubReader,
  warnings: Set<string>,
  now: () => Date,
): Promise<DiscoveryCandidate | null> {
  let packument: NpmPackument;
  try {
    packument = await registry.getPackument(hit.name);
  } catch {
    warnings.add(`npm metadata is unavailable for ${hit.name}`);
    return basicCandidate(hit, relevanceFit);
  }

  const version = selectPackageVersion(packument);
  const status = assessPackageStatus(packument);
  const identity = extractPackageIdentity(packument, version);
  const license = extractLicenseSignal(packument, version);
  const runtime = extractRuntimeCompatibility(
    version,
    hasConstraint(intent, "runtime", "node") ? "24.0.0" : undefined,
  );
  const modules = extractModuleSignals(version);
  const downloadsResult = await registry.getWeeklyDownloads(hit.name).catch(() => null);
  const enrichGitHub = identity.github !== null && rankIndex < GITHUB_ENRICHMENT_LIMIT;
  const repositoryResult =
    enrichGitHub && identity.github
      ? await github
          .repository(identity.github.owner, identity.github.repository)
          .catch((error) => {
            warnings.add(githubWarning(error));
            return null;
          })
      : null;
  const activityResult =
    enrichGitHub && identity.github
      ? await github.activity(identity.github.owner, identity.github.repository).catch((error) => {
          warnings.add(githubWarning(error));
          return null;
        })
      : null;
  const readmeResult =
    enrichGitHub && identity.github
      ? await github
          .readme(identity.github.owner, identity.github.repository, 24 * 1_024)
          .catch((error) => {
            warnings.add(githubWarning(error));
            return null;
          })
      : null;

  const daysSinceCommit =
    activityResult?.daysSinceCommit ??
    ageInDays(repositoryResult?.data.pushedAt ?? hit.date, now());
  const archived = repositoryResult?.data.archived ?? false;
  const deprecated = status.deprecated;
  const risk = deprecated || archived ? "high" : repositoryResult ? "low" : "unknown";
  const evidenceIds = [
    `npm:${hit.name}:search`,
    `npm:${hit.name}:metadata`,
    ...(downloadsResult ? [`npm:${hit.name}:downloads`] : []),
    ...(repositoryResult ? [`github:${repositoryResult.data.identity.fullName}:metadata`] : []),
    ...(activityResult
      ? [`github:${identity.github?.owner}/${identity.github?.repository}:activity`]
      : []),
    ...(readmeResult?.status === "present"
      ? [`github:${identity.github?.owner}/${identity.github?.repository}:readme`]
      : []),
  ];
  const licenseExpression = license.expression;

  return {
    id: `npm:${hit.name}`,
    queryLanguage: intent.language,
    evidenceIds,
    taskFit: taskFit(relevanceFit, intent, modules),
    ...(daysSinceCommit === null ? {} : { daysSinceCommit }),
    runtimeCompatible: runtimeCompatibility(intent, runtime.compatibility, hit),
    ...(downloadsResult?.downloads === null || downloadsResult === null
      ? {}
      : { weeklyDownloads: downloadsResult.downloads }),
    ...(repositoryResult ? { stars: repositoryResult.data.stars } : {}),
    ...(readmeResult?.status === "present" ? { readmeBytes: readmeResult.bytes } : {}),
    ...(readmeResult?.text
      ? { hasExamples: /\b(example|usage|quickstart|örnek)\b/iu.test(readmeResult.text) }
      : {}),
    licenseCompatible: licenseCompatibility(intent, licenseExpression),
    deprecated,
    archived,
    securityRisk: risk === "high" ? "high" : risk === "low" ? "none" : "unknown",
    details: {
      packageName: hit.name,
      version: version.version,
      description: packument.description ?? hit.description ?? null,
      repositoryUrl: identity.repositoryUrl,
      weeklyDownloads: downloadsResult?.downloads ?? null,
      stars: repositoryResult?.data.stars ?? null,
      license: licenseExpression,
      freshness: daysSinceCommit === null ? "unknown" : daysSinceCommit <= 365 ? "fresh" : "stale",
      risk,
      evidence: [
        `npm ${version.version} · ${formatDate(packument.fetchedAt)}`,
        downloadsResult?.downloads === null || downloadsResult === null
          ? "Weekly downloads · unknown"
          : `${formatNumber(downloadsResult.downloads)} downloads / week`,
        repositoryResult
          ? `GitHub · ${formatNumber(repositoryResult.data.stars)} stars`
          : "GitHub metadata · unknown",
        daysSinceCommit === null
          ? "Last activity · unknown"
          : `Last activity · ${daysSinceCommit} days ago`,
      ],
    },
  };
}

function basicCandidate(hit: NpmSearchHit, relevanceFit: number): DiscoveryCandidate {
  return {
    id: `npm:${hit.name}`,
    evidenceIds: [`npm:${hit.name}:search`],
    taskFit: relevanceFit,
    securityRisk: "unknown",
    details: {
      packageName: hit.name,
      version: hit.version,
      description: hit.description ?? null,
      repositoryUrl: null,
      weeklyDownloads: null,
      stars: null,
      license: null,
      freshness: "unknown",
      risk: "unknown",
      evidence: [`npm search · ${formatDate(hit.date ?? new Date().toISOString())}`],
    },
  };
}

function createCandidateClassifier(model: ModelProvider): CandidateClassifier {
  return async (intent, hits) => {
    const fallback = deterministicCandidateClassification(intent, hits);
    if (hits.length === 0) return fallback;
    try {
      const health = await model.health();
      if (!health.available)
        return {
          ...fallback,
          warning: "Ollama relevance checks were unavailable; deterministic filtering was used.",
        };
      const allowedIds = new Set(hits.map((hit) => `npm:${hit.name}`));
      const result = await generateStructured(
        model,
        {
          system:
            "You are a strict npm package relevance gate. Assess only allowlisted candidates. A package is relevant only when its primary purpose directly satisfies the requested library capability. Project context nouns such as todo, dashboard, shop, or blog are not the requested capability by themselves. Do not reward popularity. Do not invent packages or features. Return schema-valid JSON.",
          prompt: buildBoundedPrompt({
            task: `User query: ${intent.normalizedQuery}\nParsed task: ${intent.task}\nConstraints: ${intent.constraints.map((item) => `${item.kind}:${item.operator}:${item.value}`).join(", ") || "none"}\nClassify every candidate. Use relevant for a direct fit, conditional for a plausible fit with an important caveat, and irrelevant otherwise. fit is 0-100 and measures only task relevance.`,
            candidates: hits.map((hit) => ({
              id: `npm:${hit.name}`,
              evidence: `name=${hit.name}; description=${hit.description ?? "unknown"}; keywords=${hit.keywords.join(",") || "none"}`,
            })),
          }),
          schema: {
            type: "object",
            properties: {
              assessments: {
                type: "array",
                minItems: hits.length,
                maxItems: hits.length,
                items: {
                  type: "object",
                  properties: {
                    candidateId: { type: "string" },
                    verdict: { type: "string", enum: ["relevant", "conditional", "irrelevant"] },
                    fit: { type: "integer", minimum: 0, maximum: 100 },
                    reason: { type: "string", minLength: 3, maxLength: 240 },
                  },
                  required: ["candidateId", "verdict", "fit", "reason"],
                  additionalProperties: false,
                },
              },
            },
            required: ["assessments"],
            additionalProperties: false,
          },
        },
        (value): value is { assessments: CandidateAssessment[] } => {
          if (!value || typeof value !== "object") return false;
          const assessments = (value as { assessments?: unknown }).assessments;
          if (!Array.isArray(assessments) || assessments.length !== hits.length) return false;
          const ids = new Set<string>();
          for (const item of assessments) {
            if (!item || typeof item !== "object") return false;
            const assessment = item as Record<string, unknown>;
            if (
              typeof assessment.candidateId !== "string" ||
              !allowedIds.has(assessment.candidateId) ||
              ids.has(assessment.candidateId) ||
              !["relevant", "conditional", "irrelevant"].includes(String(assessment.verdict)) ||
              !Number.isInteger(assessment.fit) ||
              Number(assessment.fit) < 0 ||
              Number(assessment.fit) > 100 ||
              typeof assessment.reason !== "string" ||
              assessment.reason.length < 3 ||
              assessment.reason.length > 240
            )
              return false;
            ids.add(assessment.candidateId);
          }
          return ids.size === allowedIds.size;
        },
        1,
      );
      return result;
    } catch {
      return {
        ...fallback,
        warning: "The Ollama relevance response was invalid; deterministic filtering was used.",
      };
    }
  };
}

function deterministicCandidateClassification(
  intent: SearchIntent,
  hits: readonly NpmSearchHit[],
): Readonly<{ assessments: readonly CandidateAssessment[]; warning?: string }> {
  const capabilityTokens = relevanceTokens(searchText(intent).replaceAll("keywords:", ""));
  const framework = intent.constraints.find(
    (constraint) => constraint.kind === "framework" && constraint.operator !== "excluded",
  )?.value;
  return {
    assessments: hits.map((hit) => {
      const evidence = relevanceTokens(
        `${hit.name} ${hit.description ?? ""} ${hit.keywords.join(" ")}`,
      );
      const capabilityMatches = capabilityTokens.filter((token) => evidence.includes(token)).length;
      const frameworkMatch = framework ? evidence.includes(framework.toLowerCase()) : false;
      let fit = 25 + Math.min(65, capabilityMatches * 50);
      if (frameworkMatch) fit += 15;
      if (hasConstraint(intent, "feature", "typescript") && evidence.includes("typescript"))
        fit += 5;
      fit = Math.min(100, fit);
      return {
        candidateId: `npm:${hit.name}`,
        verdict: fit >= 70 ? "relevant" : fit >= 55 ? "conditional" : "irrelevant",
        fit,
        reason:
          capabilityMatches > 0
            ? "The package metadata matches the requested core capability."
            : "The package metadata does not directly match the requested core capability.",
      };
    }),
  };
}

function relevanceTokens(value: string): string[] {
  const ignored = new Set(["react", "node", "node.js", "js", "javascript", "typescript"]);
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}.-]+/u)
        .filter((token) => token.length >= 2 && !ignored.has(token)),
    ),
  ];
}

async function explainCandidate(
  model: ModelProvider,
  candidate: DiscoveryCandidate,
): Promise<Readonly<{ text: string; generatedBy: "ollama" | "deterministic-fallback" }>> {
  const details = candidate.details;
  const fallback = deterministicSummary(candidate);
  if (!details) return { text: fallback, generatedBy: "deterministic-fallback" };
  try {
    const health = await model.health();
    if (!health.available) return { text: fallback, generatedBy: "deterministic-fallback" };
    const result = await generateStructured(
      model,
      {
        system: `You explain npm package recommendations using only supplied evidence. Never invent features. Return one concise sentence in ${candidate.queryLanguage === "tr" ? "Turkish" : "English"}, as schema-valid JSON.`,
        prompt: buildBoundedPrompt({
          task: `Explain why this package may fit. Package: ${details.packageName}. Version: ${details.version ?? "unknown"}. Description: ${details.description ?? "unknown"}. Weekly downloads: ${details.weeklyDownloads ?? "unknown"}. GitHub stars: ${details.stars ?? "unknown"}. License: ${details.license ?? "unknown"}. Risk: ${details.risk}.`,
          candidates: [{ id: candidate.id, evidence: details.evidence.join("; ") }],
        }),
        schema: {
          type: "object",
          properties: { summary: { type: "string", minLength: 10, maxLength: 500 } },
          required: ["summary"],
          additionalProperties: false,
        },
      },
      (value): value is { summary: string } =>
        Boolean(
          value &&
            typeof value === "object" &&
            typeof (value as { summary?: unknown }).summary === "string" &&
            (value as { summary: string }).summary.length >= 10 &&
            (value as { summary: string }).summary.length <= 500,
        ),
      1,
    );
    return { text: result.summary, generatedBy: "ollama" };
  } catch {
    return { text: fallback, generatedBy: "deterministic-fallback" };
  }
}

function deterministicSummary(candidate: DiscoveryCandidate): string {
  const details = candidate.details;
  if (!details) return `${candidate.id} was found in live npm search results.`;
  const downloads =
    details.weeklyDownloads === null
      ? "download data is unavailable"
      : `${formatNumber(details.weeklyDownloads)} weekly downloads`;
  return `${details.packageName} was ranked from live npm results with ${downloads} and a ${details.license ?? "unknown"} license signal.`;
}

function searchText(intent: SearchIntent): string {
  const intentText = `${intent.normalizedQuery} ${intent.task}`;
  const domainQueries: readonly [RegExp, string][] = [
    [/\b(logger|logging|loglama)\b/iu, "keywords:logger"],
    [/\b(pdf)\b/iu, "keywords:pdf"],
    [/\b(chart|graph|grafik|visualization)\b/iu, "keywords:chart"],
    [/\b(validation|validator|doğrulama|schema)\b/iu, "keywords:validation"],
    [/\b(form|formlar?)\b/iu, "keywords:form"],
    [/\b(state management|state manager|durum yönetimi|store)\b/iu, "state management"],
    [/\b(router|routing|yönlendirme)\b/iu, "keywords:router"],
    [/\b(orm|database|veritabanı)\b/iu, "keywords:orm"],
    [/\b(editor|rich text|metin editörü)\b/iu, "keywords:editor"],
    [/\b(redis)\b/iu, "keywords:redis"],
    [/\b(queue|kuyruk)\b/iu, "keywords:queue"],
    [/\b(http client|fetch client)\b/iu, "keywords:http-client"],
    [/\b(auth|authentication|kimlik doğrulama)\b/iu, "keywords:authentication"],
    [/\b(test|testing|e2e)\b/iu, "keywords:testing"],
    [/\b(date|time|tarih|moment)\b/iu, "keywords:date"],
    [/\b(csv)\b/iu, "keywords:csv"],
  ];
  const matchedDomain = domainQueries.find(([pattern]) => pattern.test(intentText));
  if (matchedDomain) {
    const framework = intent.constraints.find(
      (constraint) => constraint.kind === "framework" && constraint.operator !== "excluded",
    );
    return [matchedDomain[1], framework?.value].filter(Boolean).join(" ");
  }

  const stopWords = new Set([
    "arıyorum",
    "bul",
    "için",
    "kütüphane",
    "paket",
    "istiyorum",
    "need",
    "find",
    "library",
    "package",
    "with",
    "that",
    "node",
    "node.js",
    "nodejs",
    "typescript",
    "javascript",
    "hızlı",
    "hafif",
    "destekli",
  ]);
  const tokens = intent.normalizedQuery
    .split(/[^\p{L}\p{N}.+#@_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopWords.has(token));
  return [...new Set(tokens)].slice(0, 8).join(" ") || intent.task;
}

function taskFit(
  relevanceFit: number,
  intent: SearchIntent,
  modules: ReturnType<typeof extractModuleSignals>,
): number {
  let score = relevanceFit;
  if (hasConstraint(intent, "feature", "typescript") && modules.types === "bundled") score += 8;
  if (hasConstraint(intent, "feature", "esm") && ["esm", "dual"].includes(modules.moduleFormat))
    score += 8;
  return Math.round(Math.max(0, Math.min(100, score)));
}

function runtimeCompatibility(
  intent: SearchIntent,
  nodeCompatibility: "compatible" | "incompatible" | "unknown",
  hit: NpmSearchHit,
): boolean | "unknown" {
  if (hasConstraint(intent, "runtime", "node"))
    return nodeCompatibility === "compatible"
      ? true
      : nodeCompatibility === "incompatible"
        ? false
        : "unknown";
  if (hasConstraint(intent, "runtime", "browser"))
    return hit.keywords.some((keyword) => /browser|client-side/iu.test(keyword)) ? true : "unknown";
  return "unknown";
}

function licenseCompatibility(
  intent: SearchIntent,
  expression: string | null,
): boolean | "unknown" {
  if (!expression) return "unknown";
  const normalized = expression.toUpperCase();
  const required = intent.constraints.find(
    (constraint) => constraint.kind === "license" && constraint.operator !== "excluded",
  );
  const excluded = intent.constraints.find(
    (constraint) => constraint.kind === "license" && constraint.operator === "excluded",
  );
  if (required) return normalized.includes(required.value.toUpperCase());
  if (excluded && normalized.includes(excluded.value.toUpperCase())) return false;
  return [...PERMISSIVE_LICENSES].some((license) => normalized.includes(license))
    ? true
    : "unknown";
}

function hasConstraint(intent: SearchIntent, kind: string, value: string): boolean {
  return intent.constraints.some(
    (constraint) =>
      constraint.kind === kind &&
      constraint.value.toLowerCase() === value.toLowerCase() &&
      constraint.operator !== "excluded",
  );
}

function githubWarning(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as GitHubError).code).toLowerCase()
      : "unavailable";
  return `GitHub metadata is incomplete: ${code}`;
}

function ageInDays(value: string | null | undefined, now: Date): number | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000));
}

function formatDate(value: string): string {
  return Number.isNaN(Date.parse(value)) ? "unknown" : value.slice(0, 10);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}
