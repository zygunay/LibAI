import type {
  GitHubAdapter,
  GitHubQueryValue,
  GitHubRateLimit,
  GitHubResponse,
} from "./adapter.js";
import { GitHubError } from "./adapter.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type GitHubClientOptions = Readonly<{
  token?: string;
  fetch?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  baseUrl?: string;
  userAgent?: string;
}>;

const DEFAULT_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2022-11-28";

export class GitHubClient implements GitHubAdapter {
  readonly authenticated: boolean;
  protected readonly fetcher: FetchLike;
  protected readonly now: () => Date;
  protected readonly timeoutMs: number;
  protected readonly baseUrl: URL;
  protected readonly userAgent: string;
  #token: string | undefined;

  constructor(options: GitHubClientOptions = {}) {
    const token = normalizeToken(options.token);
    this.authenticated = token !== undefined;
    this.#token = token;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.baseUrl = parseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.userAgent = options.userAgent ?? "LibAI/0.0.0";

    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new GitHubError("INVALID_CONFIG", "GitHub timeout must be a positive integer");
    }
    if (!this.userAgent.trim() || hasControlCharacters(this.userAgent)) {
      throw new GitHubError("INVALID_CONFIG", "GitHub user agent is invalid");
    }
  }

  async get<T>(
    path: string,
    options: Readonly<{ query?: Readonly<Record<string, GitHubQueryValue>> }> = {},
  ): Promise<GitHubResponse<T>> {
    const url = this.createUrl(path, options.query);
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": this.userAgent,
      "x-github-api-version": DEFAULT_API_VERSION,
    };
    if (this.#token) headers.authorization = `Bearer ${this.#token}`;

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timeout =
        cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      throw new GitHubError(timeout ? "TIMEOUT" : "NETWORK", "GitHub request failed", {
        retryable: true,
        cause,
      });
    }

    const rateLimit = readRateLimit(response.headers);
    if (!response.ok) throw mapHttpError(response.status, rateLimit);

    let data: T;
    try {
      data = (await response.json()) as T;
    } catch (cause) {
      throw new GitHubError("INVALID_RESPONSE", "GitHub returned invalid JSON", { cause });
    }

    return {
      data,
      sourceUrl: url.toString(),
      fetchedAt: this.now().toISOString(),
      rateLimit,
    };
  }

  private createUrl(
    path: string,
    query: Readonly<Record<string, GitHubQueryValue>> | undefined,
  ): URL {
    if (!path.startsWith("/") || path.startsWith("//") || hasControlCharacters(path)) {
      throw new GitHubError("INVALID_REQUEST", "GitHub path must be an absolute API path");
    }
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new GitHubError("INVALID_REQUEST", "GitHub path resolved outside the API origin");
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }
}

function normalizeToken(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (hasControlCharacters(value)) {
    throw new GitHubError("INVALID_CONFIG", "GitHub token contains invalid characters");
  }
  return value.trim();
}

function parseBaseUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error("insecure protocol");
    }
    return url;
  } catch (cause) {
    throw new GitHubError("INVALID_CONFIG", "GitHub base URL is invalid", { cause });
  }
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function parseIntegerHeader(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readRateLimit(headers: Headers): GitHubRateLimit {
  const reset = parseIntegerHeader(headers.get("x-ratelimit-reset"));
  return {
    limit: parseIntegerHeader(headers.get("x-ratelimit-limit")),
    remaining: parseIntegerHeader(headers.get("x-ratelimit-remaining")),
    resetAt: reset === null ? null : new Date(reset * 1000).toISOString(),
  };
}

function mapHttpError(status: number, rateLimit: GitHubRateLimit): GitHubError {
  const rateLimited = status === 429 || (status === 403 && rateLimit.remaining === 0);
  const code = rateLimited
    ? "RATE_LIMITED"
    : status === 401
      ? "UNAUTHORIZED"
      : status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "NOT_FOUND"
          : "NETWORK";
  return new GitHubError(code, `GitHub returned HTTP ${status}`, {
    status,
    retryable: rateLimited || status >= 500,
    rateLimit,
  });
}
