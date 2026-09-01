export type Ecosystem = "npm" | "pypi";
export type RegistryCapabilities = Readonly<{
  ecosystem: Ecosystem;
  exactMetadata: boolean;
  fullTextSearch: boolean;
  downloads: boolean;
  repositoryIdentity: boolean;
}>;
export type RegistryRecord = Readonly<{
  ecosystem: Ecosystem;
  name: string;
  version: string;
  summary: string | null;
  license: string | "unknown";
  repositoryUrl: string | null;
  sourceUrl: string;
  fetchedAt: string;
}>;
export interface RegistryAdapter {
  readonly capabilities: RegistryCapabilities;
  getProject(name: string): Promise<RegistryRecord>;
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export class RegistryError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "NOT_FOUND"
      | "RATE_LIMITED"
      | "NETWORK"
      | "INVALID_RESPONSE",
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RegistryError";
  }
}

export class PyPiAdapter implements RegistryAdapter {
  readonly capabilities: RegistryCapabilities = {
    ecosystem: "pypi",
    exactMetadata: true,
    fullTextSearch: false,
    downloads: false,
    repositoryIdentity: true,
  };
  constructor(
    private readonly options: Readonly<{
      fetch?: FetchLike;
      now?: () => Date;
      baseUrl?: string;
      timeoutMs?: number;
    }> = {},
  ) {}
  async getProject(name: string): Promise<RegistryRecord> {
    const normalized = canonicalPythonName(name);
    const url = new URL(
      `/pypi/${encodeURIComponent(normalized)}/json`,
      this.options.baseUrl ?? "https://pypi.org",
    );
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      });
    } catch (cause) {
      throw new RegistryError("NETWORK", "PyPI request failed", true, { cause });
    }
    if (!response.ok)
      throw new RegistryError(
        response.status === 404
          ? "NOT_FOUND"
          : response.status === 429
            ? "RATE_LIMITED"
            : "NETWORK",
        `PyPI returned HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    const payload = (await response.json()) as {
      info?: {
        name?: unknown;
        version?: unknown;
        summary?: unknown;
        license?: unknown;
        project_urls?: unknown;
        home_page?: unknown;
      };
    };
    const info = payload.info;
    if (!info || typeof info.name !== "string" || typeof info.version !== "string")
      throw new RegistryError("INVALID_RESPONSE", "PyPI metadata is invalid", false);
    return {
      ecosystem: "pypi",
      name: canonicalPythonName(info.name),
      version: info.version,
      summary: typeof info.summary === "string" && info.summary.trim() ? info.summary : null,
      license:
        typeof info.license === "string" && info.license.trim() ? info.license.trim() : "unknown",
      repositoryUrl: extractGitHubUrl(info.project_urls, info.home_page),
      sourceUrl: url.toString(),
      fetchedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    };
  }
}
export function canonicalPythonName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[._]+/gu, "-").replace(/-+/gu, "-");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(normalized))
    throw new RegistryError("INVALID_REQUEST", "Invalid Python project name", false);
  return normalized;
}
export function canonicalPythonRepository(
  packageName: string,
  repositoryUrl: string | null,
): Readonly<{ packageId: string; repositoryId: string | null }> {
  const packageId = `pypi:${canonicalPythonName(packageName)}`;
  if (!repositoryUrl) return { packageId, repositoryId: null };
  try {
    const url = new URL(repositoryUrl);
    const segments = url.pathname
      .replace(/\.git\/?$/u, "")
      .split("/")
      .filter(Boolean);
    if (url.hostname.toLowerCase() !== "github.com" || segments.length !== 2)
      return { packageId, repositoryId: null };
    return {
      packageId,
      repositoryId: `github:${segments[0]?.toLowerCase()}/${segments[1]?.toLowerCase()}`,
    };
  } catch {
    return { packageId, repositoryId: null };
  }
}
export const scoringProfiles = {
  npm: {
    taskFit: 0.3,
    maintenance: 0.2,
    compatibility: 0.15,
    adoption: 0.1,
    documentation: 0.1,
    license: 0.1,
    risk: 0.05,
  },
  pypi: {
    taskFit: 0.32,
    maintenance: 0.2,
    compatibility: 0.2,
    adoption: 0.06,
    documentation: 0.1,
    license: 0.07,
    risk: 0.05,
  },
} as const;
export function routeEcosystem(
  query: string,
): Readonly<{ ecosystem: Ecosystem | "ambiguous"; clarificationNeeded: boolean }> {
  const normalized = query.toLowerCase();
  const python = /\b(python|pypi|pip|django|flask|fastapi)\b/u.test(normalized);
  const npm = /\b(npm|node(?:\.js)?|react|typescript|javascript)\b/u.test(normalized);
  if (python === npm) return { ecosystem: "ambiguous", clarificationNeeded: true };
  return { ecosystem: python ? "pypi" : "npm", clarificationNeeded: false };
}
export function ecosystemEnabled(
  ecosystem: Ecosystem,
  flags: Readonly<Record<string, string | undefined>>,
): boolean {
  if (ecosystem === "npm") return true;
  return flags.LIBAI_PYPI_ENABLED === "1";
}
function extractGitHubUrl(projectUrls: unknown, homepage: unknown): string | null {
  const candidates =
    projectUrls && typeof projectUrls === "object"
      ? Object.values(projectUrls as Record<string, unknown>)
      : [];
  candidates.push(homepage);
  for (const value of candidates)
    if (typeof value === "string") {
      try {
        const url = new URL(value);
        if (
          url.hostname.toLowerCase() === "github.com" &&
          url.pathname.split("/").filter(Boolean).length >= 2
        )
          return `https://github.com/${url.pathname
            .split("/")
            .filter(Boolean)
            .slice(0, 2)
            .join("/")
            .replace(/\.git$/u, "")}`;
      } catch {
        /* continue */
      }
    }
  return null;
}
