import type { GitHubAdapter, GitHubResponse } from "./adapter.js";
import { GitHubError } from "./adapter.js";

export type RepositoryIdentity = Readonly<{
  owner: string;
  name: string;
  fullName: string;
  url: string;
}>;
export type RepositoryMetadata = Readonly<{
  identity: RepositoryIdentity;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  archived: boolean;
  fork: boolean;
  template: boolean;
  defaultBranch: string;
  pushedAt: string | null;
}>;

export type ActivitySignals = Readonly<{
  lastCommitAt: string | null;
  latestReleaseAt: string | null;
  daysSinceCommit: number | null;
  daysSinceRelease: number | null;
  releaseStatus: "present" | "missing";
}>;

export type IssuePullSignals = Readonly<{
  openIssues: number;
  closedIssues: number;
  openPullRequests: number;
  closedPullRequests: number;
  issueClosureRate: number | null;
  pullRequestClosureRate: number | null;
}>;

export type LicenseSignal = Readonly<{
  status: "spdx" | "custom" | "unknown";
  spdxId: string | null;
  name: string | null;
}>;

export type ReadmeEvidence = Readonly<{
  text: string | null;
  bytes: number;
  truncated: boolean;
  trust: "untrusted";
  status: "present" | "missing" | "binary";
}>;

export type SecuritySignals = Readonly<{
  securityPolicy: "present" | "absent" | "unknown";
  vulnerabilityAlerts: "enabled" | "disabled" | "unknown";
  archived: boolean;
  disabled: boolean;
}>;

type RepoPayload = {
  name?: unknown;
  full_name?: unknown;
  html_url?: unknown;
  description?: unknown;
  stargazers_count?: unknown;
  forks_count?: unknown;
  open_issues_count?: unknown;
  archived?: unknown;
  fork?: unknown;
  is_template?: unknown;
  default_branch?: unknown;
  pushed_at?: unknown;
  disabled?: unknown;
  license?: { spdx_id?: unknown; name?: unknown } | null;
};

export function parseRepositoryMetadata(value: unknown): RepositoryMetadata {
  const repo = requireRecord(value, "repository");
  const fullName = requiredString(repo.full_name, "full_name");
  const [owner, name] = fullName.split("/");
  if (!owner || !name || fullName.split("/").length !== 2) invalid("full_name");
  return {
    identity: { owner, name, fullName, url: requiredHttpsUrl(repo.html_url, "html_url") },
    description: nullableString(repo.description),
    stars: nonNegativeInteger(repo.stargazers_count, "stargazers_count"),
    forks: nonNegativeInteger(repo.forks_count, "forks_count"),
    openIssues: nonNegativeInteger(repo.open_issues_count, "open_issues_count"),
    archived: boolean(repo.archived, "archived"),
    fork: boolean(repo.fork, "fork"),
    template: boolean(repo.is_template, "is_template"),
    defaultBranch: requiredString(repo.default_branch, "default_branch"),
    pushedAt: nullableIsoDate(repo.pushed_at, "pushed_at"),
  };
}

export function calculateActivitySignals(
  commits: readonly unknown[],
  releases: readonly unknown[],
  now = new Date(),
): ActivitySignals {
  const lastCommitAt = nestedIsoDate(commits[0], ["commit", "committer", "date"]);
  const latestReleaseAt = nestedIsoDate(releases[0], ["published_at"]);
  return {
    lastCommitAt,
    latestReleaseAt,
    daysSinceCommit: ageInDays(lastCommitAt, now),
    daysSinceRelease: ageInDays(latestReleaseAt, now),
    releaseStatus: latestReleaseAt ? "present" : "missing",
  };
}

export function calculateIssuePullSignals(
  counts: Readonly<{
    openIssues: number;
    closedIssues: number;
    openPullRequests: number;
    closedPullRequests: number;
  }>,
): IssuePullSignals {
  for (const [field, value] of Object.entries(counts)) nonNegativeInteger(value, field);
  return {
    ...counts,
    issueClosureRate: ratio(counts.closedIssues, counts.openIssues + counts.closedIssues),
    pullRequestClosureRate: ratio(
      counts.closedPullRequests,
      counts.openPullRequests + counts.closedPullRequests,
    ),
  };
}

export function parseLanguageDistribution(value: unknown): Readonly<Record<string, number>> {
  const record = requireRecord(value, "languages");
  const result: Record<string, number> = {};
  for (const [language, bytes] of Object.entries(record))
    result[language] = nonNegativeInteger(bytes, language);
  return result;
}

export function parseTopics(value: unknown): readonly string[] {
  const record = requireRecord(value, "topics");
  if (!Array.isArray(record.names) || !record.names.every((item) => typeof item === "string"))
    invalid("topics.names");
  return [...new Set(record.names.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort();
}

export function parseLicenseSignal(value: unknown): LicenseSignal {
  const repo = requireRecord(value, "repository") as RepoPayload;
  if (!repo.license) return { status: "unknown", spdxId: null, name: null };
  const spdxId = nullableString(repo.license.spdx_id);
  const name = nullableString(repo.license.name);
  if (!spdxId || spdxId === "NOASSERTION" || spdxId === "OTHER") {
    return { status: name ? "custom" : "unknown", spdxId: null, name };
  }
  return { status: "spdx", spdxId, name };
}

export function decodeReadme(value: unknown, maxBytes = 64 * 1024): ReadmeEvidence {
  const record = requireRecord(value, "readme");
  if (record.encoding !== "base64" || typeof record.content !== "string") {
    return { text: null, bytes: 0, truncated: false, trust: "untrusted", status: "binary" };
  }
  let bytes: Uint8Array;
  try {
    const decoded = atob(record.content.replace(/\s/gu, ""));
    bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return { text: null, bytes: 0, truncated: false, trust: "untrusted", status: "binary" };
  }
  if (bytes.includes(0))
    return {
      text: null,
      bytes: bytes.length,
      truncated: false,
      trust: "untrusted",
      status: "binary",
    };
  const limited = bytes.subarray(0, maxBytes);
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(limited),
    bytes: bytes.length,
    truncated: bytes.length > maxBytes,
    trust: "untrusted",
    status: "present",
  };
}

export function missingReadme(): ReadmeEvidence {
  return { text: null, bytes: 0, truncated: false, trust: "untrusted", status: "missing" };
}

export function parseSecuritySignals(
  repoValue: unknown,
  communityValue?: unknown,
): SecuritySignals {
  const repo = requireRecord(repoValue, "repository") as RepoPayload;
  const community =
    communityValue === undefined ? undefined : requireRecord(communityValue, "community profile");
  const files =
    community && typeof community.files === "object" && community.files !== null
      ? (community.files as Record<string, unknown>)
      : undefined;
  return {
    securityPolicy: community ? (files?.security ? "present" : "absent") : "unknown",
    vulnerabilityAlerts: "unknown",
    archived: repo.archived === true,
    disabled: repo.disabled === true,
  };
}

export class GitHubDiscovery {
  constructor(
    private readonly adapter: GitHubAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async repository(owner: string, repo: string): Promise<GitHubResponse<RepositoryMetadata>> {
    const response = await this.adapter.get<unknown>(path(owner, repo));
    return { ...response, data: parseRepositoryMetadata(response.data) };
  }

  async activity(owner: string, repo: string): Promise<ActivitySignals> {
    const [commits, releases] = await Promise.all([
      this.adapter.get<unknown[]>(`${path(owner, repo)}/commits`, { query: { per_page: 1 } }),
      this.adapter.get<unknown[]>(`${path(owner, repo)}/releases`, { query: { per_page: 1 } }),
    ]);
    return calculateActivitySignals(commits.data, releases.data, this.now());
  }

  async readme(owner: string, repo: string, maxBytes?: number): Promise<ReadmeEvidence> {
    try {
      const response = await this.adapter.get<unknown>(`${path(owner, repo)}/readme`);
      return decodeReadme(response.data, maxBytes);
    } catch (error) {
      if (error instanceof GitHubError && error.code === "NOT_FOUND") return missingReadme();
      throw error;
    }
  }
}

function path(owner: string, repo: string): string {
  if (!/^[A-Za-z0-9_.-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repo)) {
    throw new GitHubError("INVALID_REQUEST", "Invalid GitHub repository identity");
  }
  return `/repos/${owner}/${repo}`;
}
function ratio(closed: number, total: number): number | null {
  return total === 0 ? null : closed / total;
}
function ageInDays(value: string | null, now: Date): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000));
}
function nestedIsoDate(value: unknown, keys: readonly string[]): string | null {
  let current: unknown = value;
  for (const key of keys)
    current =
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined;
  return nullableIsoDate(current, keys.join("."));
}
function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value;
}
function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function requiredHttpsUrl(value: unknown, field: string): string {
  const text = requiredString(value, field);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") invalid(field);
    return url.toString().replace(/\/$/u, "");
  } catch {
    return invalid(field);
  }
}
function nullableIsoDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) invalid(field);
  return new Date(value).toISOString();
}
function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(field);
  return value as number;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}
function invalid(field: string): never {
  throw new GitHubError("INVALID_RESPONSE", `Invalid GitHub ${field}`);
}
