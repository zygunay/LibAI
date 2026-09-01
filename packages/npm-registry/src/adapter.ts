export type NpmSearchHit = Readonly<{
  name: string;
  version: string;
  description?: string;
  keywords: readonly string[];
  score: number;
  publisher?: string;
  date?: string;
}>;

export type NpmSearchPage = Readonly<{
  objects: readonly NpmSearchHit[];
  total: number;
  sourceUrl: string;
  fetchedAt: string;
}>;

export type NpmPackageVersion = Readonly<{
  name: string;
  version: string;
  deprecated?: string;
  repository?: unknown;
  homepage?: unknown;
  engines?: Readonly<Record<string, string>>;
  types?: string;
  typings?: string;
  type?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  license?: unknown;
  dist?: Readonly<{
    tarball?: string;
    unpackedSize?: number;
    fileCount?: number;
  }>;
}>;

export type NpmPackument = Readonly<{
  name: string;
  description?: string;
  "dist-tags": Readonly<Record<string, string>>;
  versions: Readonly<Record<string, NpmPackageVersion>>;
  time?: Readonly<Record<string, string>>;
  repository?: unknown;
  homepage?: unknown;
  license?: unknown;
  sourceUrl: string;
  fetchedAt: string;
}>;

export type NpmDownloadPoint = Readonly<{
  packageName: string;
  downloads: number | null;
  start: string;
  end: string;
  sourceUrl: string;
  fetchedAt: string;
}>;

export interface NpmRegistryAdapter {
  search(
    query: string,
    options?: Readonly<{ limit?: number; from?: number }>,
  ): Promise<NpmSearchPage>;
  getPackument(packageName: string): Promise<NpmPackument>;
  getWeeklyDownloads(packageName: string, endDate?: string): Promise<NpmDownloadPoint>;
}

export type NpmRegistryErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_RESPONSE";

export class NpmRegistryError extends Error {
  readonly code: NpmRegistryErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: NpmRegistryErrorCode,
    message: string,
    options: Readonly<{ retryable?: boolean; status?: number; cause?: unknown }> = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "NpmRegistryError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.status !== undefined) this.status = options.status;
  }
}
