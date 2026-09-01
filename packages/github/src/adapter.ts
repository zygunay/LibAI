export type GitHubQueryValue = string | number | boolean | undefined;

export type GitHubRateLimit = Readonly<{
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}>;

export type GitHubResponse<T> = Readonly<{
  data: T;
  sourceUrl: string;
  fetchedAt: string;
  rateLimit: GitHubRateLimit;
}>;

export interface GitHubAdapter {
  get<T>(
    path: string,
    options?: Readonly<{ query?: Readonly<Record<string, GitHubQueryValue>> }>,
  ): Promise<GitHubResponse<T>>;
}

export type GitHubErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_RESPONSE";

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly rateLimit?: GitHubRateLimit;

  constructor(
    code: GitHubErrorCode,
    message: string,
    options: Readonly<{
      retryable?: boolean;
      status?: number;
      rateLimit?: GitHubRateLimit;
      cause?: unknown;
    }> = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GitHubError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.status !== undefined) this.status = options.status;
    if (options.rateLimit !== undefined) this.rateLimit = options.rateLimit;
  }
}
