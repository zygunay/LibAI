export type PackageIdentity = Readonly<{ ecosystem: "npm"; name: string }>;
export type RepositoryIdentity = Readonly<{
  host: "github";
  owner: string;
  repository: string;
  url: string;
}>;
export type EvidenceSource = "npm" | "github";
export type Evidence<T = unknown> = Readonly<{
  id: string;
  source: EvidenceSource;
  field: string;
  value: T;
  sourceUrl: string;
  fetchedAt: string;
  transform: readonly string[];
}>;
export type EvidenceConflict = Readonly<{
  field: string;
  winnerEvidenceId: string;
  loserEvidenceIds: readonly string[];
  rule: string;
}>;
export type NormalizationTrace = Readonly<{
  steps: readonly string[];
  conflicts: readonly EvidenceConflict[];
}>;
export type UnifiedCandidate = Readonly<{
  id: string;
  package: PackageIdentity | null;
  repository: RepositoryIdentity | null;
  fields: Readonly<Record<string, unknown>>;
  evidence: readonly Evidence[];
  trace: NormalizationTrace;
}>;

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export function canonicalizePackageName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(normalized)) {
    throw new Error("Invalid npm package name");
  }
  return normalized;
}

export function canonicalizeRepositoryUrl(input: string): RepositoryIdentity {
  let value = input.trim();
  const ssh = /^git@github\.com:([^/]+)\/(.+)$/iu.exec(value);
  if (ssh) value = `https://github.com/${ssh[1]}/${ssh[2]}`;
  if (/^git:\/\/github\.com\//iu.test(value)) value = value.replace(/^git:\/\//iu, "https://");
  if (!/^[a-z]+:\/\//iu.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid repository URL");
  }
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password)
    throw new Error("Unsupported repository URL");
  const segments = url.pathname.replace(/\/+$/u, "").split("/").filter(Boolean);
  if (segments.length !== 2) throw new Error("GitHub repository URL must identify one repository");
  const owner = segments[0]?.toLowerCase();
  const repository = segments[1]?.replace(/\.git$/iu, "").toLowerCase();
  if (
    !owner ||
    !repository ||
    !/^[a-z0-9_.-]+$/u.test(owner) ||
    !/^[a-z0-9_.-]+$/u.test(repository)
  ) {
    throw new Error("Invalid GitHub repository identity");
  }
  return { host: "github", owner, repository, url: `https://github.com/${owner}/${repository}` };
}

export function mapNpmRepository(
  packageName: string,
  repositoryUrl: string | null | undefined,
  homepage?: string | null,
): Readonly<{
  package: PackageIdentity;
  repository: RepositoryIdentity | null;
  confidence: "verified" | "none";
}> {
  const packageIdentity = { ecosystem: "npm" as const, name: canonicalizePackageName(packageName) };
  if (!repositoryUrl) return { package: packageIdentity, repository: null, confidence: "none" };
  try {
    const repository = canonicalizeRepositoryUrl(repositoryUrl);
    if (homepage) {
      try {
        const home = canonicalizeRepositoryUrl(homepage);
        if (home.url !== repository.url)
          return { package: packageIdentity, repository: null, confidence: "none" };
      } catch {
        /* non-repository homepages do not contradict registry metadata */
      }
    }
    return { package: packageIdentity, repository, confidence: "verified" };
  } catch {
    return { package: packageIdentity, repository: null, confidence: "none" };
  }
}

export function createEvidence<T>(
  input: Omit<Evidence<T>, "id" | "transform"> & { transform?: readonly string[] },
): Evidence<T> {
  if (!/^https:\/\//u.test(input.sourceUrl) || Number.isNaN(Date.parse(input.fetchedAt)))
    throw new Error("Evidence requires source URL and fetchedAt");
  const fingerprint = stableHash(
    `${input.source}|${input.field}|${input.sourceUrl}|${input.fetchedAt}|${stableStringify(input.value)}`,
  );
  return { ...input, id: `ev_${fingerprint}`, transform: input.transform ?? [] };
}

export function freshness(fetchedAt: string, now: Date, maxAgeMs: number): "fresh" | "stale" {
  const timestamp = Date.parse(fetchedAt);
  if (Number.isNaN(timestamp) || maxAgeMs < 0) throw new Error("Invalid freshness input");
  return now.getTime() - timestamp <= maxAgeMs ? "fresh" : "stale";
}

export function unknownIfMissing<T>(value: T | null | undefined): T | "unknown" {
  return value === null || value === undefined ? "unknown" : value;
}

export function normalizeCandidate(
  input: Readonly<{
    packageName?: string;
    repositoryUrl?: string;
    evidence: readonly Evidence[];
    sourcePriority?: readonly EvidenceSource[];
  }>,
): UnifiedCandidate {
  const packageIdentity = input.packageName
    ? { ecosystem: "npm" as const, name: canonicalizePackageName(input.packageName) }
    : null;
  const repository = input.repositoryUrl ? canonicalizeRepositoryUrl(input.repositoryUrl) : null;
  if (!packageIdentity && !repository)
    throw new Error("Candidate needs a package or repository identity");
  const priority = input.sourcePriority ?? ["npm", "github"];
  const grouped = new Map<string, Evidence[]>();
  for (const evidence of input.evidence)
    grouped.set(evidence.field, [...(grouped.get(evidence.field) ?? []), evidence]);
  const fields: Record<string, unknown> = {};
  const conflicts: EvidenceConflict[] = [];
  for (const [field, values] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...values].sort(
      (a, b) =>
        priority.indexOf(a.source) - priority.indexOf(b.source) ||
        b.fetchedAt.localeCompare(a.fetchedAt),
    );
    const winner = sorted[0];
    if (!winner) continue;
    fields[field] = unknownIfMissing(winner.value);
    const losers = sorted
      .slice(1)
      .filter((item) => stableStringify(item.value) !== stableStringify(winner.value));
    if (losers.length)
      conflicts.push({
        field,
        winnerEvidenceId: winner.id,
        loserEvidenceIds: losers.map((item) => item.id),
        rule: `source-priority:${priority.join(">")};then-newest`,
      });
  }
  const id = packageIdentity
    ? `npm:${packageIdentity.name}`
    : `github:${repository?.owner}/${repository?.repository}`;
  return {
    id,
    package: packageIdentity,
    repository,
    fields,
    evidence: [...input.evidence].sort((a, b) => a.id.localeCompare(b.id)),
    trace: {
      steps: [
        "canonicalize-identity",
        "group-evidence-by-field",
        "resolve-source-priority",
        "preserve-unknown",
      ],
      conflicts,
    },
  };
}

export function deduplicateCandidates(
  candidates: readonly UnifiedCandidate[],
): readonly UnifiedCandidate[] {
  const groups = new Map<string, UnifiedCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.repository ? candidate.repository.url : candidate.id;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const first = group[0];
      if (!first || group.length === 1) return first as UnifiedCandidate;
      const packageName = group.find((item) => item.package)?.package?.name;
      return normalizeCandidate({
        ...(packageName ? { packageName } : {}),
        ...(first.repository ? { repositoryUrl: first.repository.url } : {}),
        evidence: group.flatMap((item) => item.evidence),
      });
    });
}

export function evidenceSnapshot(candidate: UnifiedCandidate): string {
  return stableStringify(candidate);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
