import type {
  NpmDownloadPoint,
  NpmPackageVersion,
  NpmPackument,
  NpmRegistryAdapter,
  NpmSearchPage,
} from "./adapter.js";
import { NpmRegistryError } from "./adapter.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type NpmRegistryClientOptions = Readonly<{
  fetch?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  registryBaseUrl?: string;
  downloadsBaseUrl?: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class NpmRegistryClient implements NpmRegistryAdapter {
  protected readonly fetcher: FetchLike;
  protected readonly now: () => Date;
  protected readonly timeoutMs: number;
  protected readonly registryBaseUrl: string;
  protected readonly downloadsBaseUrl: string;

  constructor(options: NpmRegistryClientOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.registryBaseUrl = options.registryBaseUrl ?? "https://registry.npmjs.org";
    this.downloadsBaseUrl = options.downloadsBaseUrl ?? "https://api.npmjs.org";
  }

  protected async requestJson(url: URL): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timeout = cause instanceof Error && cause.name === "TimeoutError";
      throw new NpmRegistryError(timeout ? "TIMEOUT" : "NETWORK", "npm request failed", {
        retryable: true,
        cause,
      });
    }
    if (!response.ok) {
      const code =
        response.status === 404
          ? "NOT_FOUND"
          : response.status === 429
            ? "RATE_LIMITED"
            : "NETWORK";
      throw new NpmRegistryError(code, `npm returned HTTP ${response.status}`, {
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
      });
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new NpmRegistryError("INVALID_RESPONSE", "npm returned invalid JSON", { cause });
    }
  }

  async search(
    query: string,
    options: Readonly<{ limit?: number; from?: number }> = {},
  ): Promise<NpmSearchPage> {
    const text = query.trim();
    const limit = options.limit ?? 20;
    const from = options.from ?? 0;
    if (!text || !Number.isInteger(limit) || limit < 1 || limit > 250 || from < 0) {
      throw new NpmRegistryError("INVALID_REQUEST", "Invalid npm search parameters");
    }
    const url = new URL("/-/v1/search", this.registryBaseUrl);
    url.searchParams.set("text", text);
    url.searchParams.set("size", String(limit));
    url.searchParams.set("from", String(from));
    const body = await this.requestJson(url);
    if (!isRecord(body) || !Array.isArray(body.objects) || typeof body.total !== "number") {
      throw new NpmRegistryError("INVALID_RESPONSE", "Invalid npm search response");
    }
    const objects = body.objects.map((entry): NpmSearchPage["objects"][number] => {
      if (!isRecord(entry) || !isRecord(entry.package) || typeof entry.package.name !== "string") {
        throw new NpmRegistryError("INVALID_RESPONSE", "Invalid npm search result");
      }
      const pkg = entry.package;
      const name = pkg.name as string;
      const score =
        isRecord(entry.score) && typeof entry.score.final === "number" ? entry.score.final : 0;
      return {
        name,
        version: typeof pkg.version === "string" ? pkg.version : "unknown",
        keywords: Array.isArray(pkg.keywords)
          ? pkg.keywords.filter((value): value is string => typeof value === "string")
          : [],
        score,
        ...(typeof pkg.description === "string" ? { description: pkg.description } : {}),
        ...(isRecord(pkg.publisher) && typeof pkg.publisher.username === "string"
          ? { publisher: pkg.publisher.username }
          : {}),
        ...(typeof pkg.date === "string" ? { date: pkg.date } : {}),
      };
    });
    return {
      objects,
      total: body.total,
      sourceUrl: url.toString(),
      fetchedAt: this.now().toISOString(),
    };
  }

  async getPackument(packageName: string): Promise<NpmPackument> {
    if (!/^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u.test(packageName)) {
      throw new NpmRegistryError("INVALID_REQUEST", "Invalid npm package name");
    }
    const url = new URL(`/${encodeURIComponent(packageName)}`, this.registryBaseUrl);
    const body = await this.requestJson(url);
    if (
      !isRecord(body) ||
      typeof body.name !== "string" ||
      !isRecord(body["dist-tags"]) ||
      !isRecord(body.versions)
    ) {
      throw new NpmRegistryError("INVALID_RESPONSE", "Invalid npm packument");
    }
    const distTags = Object.fromEntries(
      Object.entries(body["dist-tags"]).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const versions: Record<string, NpmPackageVersion> = {};
    for (const [versionKey, raw] of Object.entries(body.versions)) {
      if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.version !== "string")
        continue;
      const engines = isRecord(raw.engines)
        ? Object.fromEntries(
            Object.entries(raw.engines).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : undefined;
      const dist = isRecord(raw.dist)
        ? {
            ...(typeof raw.dist.tarball === "string" ? { tarball: raw.dist.tarball } : {}),
            ...(typeof raw.dist.unpackedSize === "number"
              ? { unpackedSize: raw.dist.unpackedSize }
              : {}),
            ...(typeof raw.dist.fileCount === "number" ? { fileCount: raw.dist.fileCount } : {}),
          }
        : undefined;
      versions[versionKey] = {
        name: raw.name,
        version: raw.version,
        ...(typeof raw.deprecated === "string" ? { deprecated: raw.deprecated } : {}),
        ...(raw.repository !== undefined ? { repository: raw.repository } : {}),
        ...(raw.homepage !== undefined ? { homepage: raw.homepage } : {}),
        ...(engines ? { engines } : {}),
        ...(typeof raw.types === "string" ? { types: raw.types } : {}),
        ...(typeof raw.typings === "string" ? { typings: raw.typings } : {}),
        ...(typeof raw.type === "string" ? { type: raw.type } : {}),
        ...(typeof raw.main === "string" ? { main: raw.main } : {}),
        ...(typeof raw.module === "string" ? { module: raw.module } : {}),
        ...(raw.exports !== undefined ? { exports: raw.exports } : {}),
        ...(raw.license !== undefined ? { license: raw.license } : {}),
        ...(dist ? { dist } : {}),
      };
    }
    const time = isRecord(body.time)
      ? Object.fromEntries(
          Object.entries(body.time).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
    return {
      name: body.name,
      "dist-tags": distTags,
      versions,
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(time ? { time } : {}),
      ...(body.repository !== undefined ? { repository: body.repository } : {}),
      ...(body.homepage !== undefined ? { homepage: body.homepage } : {}),
      ...(body.license !== undefined ? { license: body.license } : {}),
      sourceUrl: url.toString(),
      fetchedAt: this.now().toISOString(),
    };
  }

  async getWeeklyDownloads(packageName: string, endDate?: string): Promise<NpmDownloadPoint> {
    if (!/^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u.test(packageName)) {
      throw new NpmRegistryError("INVALID_REQUEST", "Invalid npm package name");
    }
    const end = endDate ? parseDateOnly(endDate) : previousUtcDay(this.now());
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    const startText = formatDateOnly(start);
    const endText = formatDateOnly(end);
    const url = new URL(
      `/downloads/point/${startText}:${endText}/${encodeURIComponent(packageName)}`,
      this.downloadsBaseUrl,
    );
    const body = await this.requestJson(url);
    if (!isRecord(body)) {
      throw new NpmRegistryError("INVALID_RESPONSE", "Invalid npm downloads response");
    }
    const downloads =
      typeof body.downloads === "number" && Number.isFinite(body.downloads) ? body.downloads : null;
    return {
      packageName,
      downloads,
      start: startText,
      end: endText,
      sourceUrl: url.toString(),
      fetchedAt: this.now().toISOString(),
    };
  }
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new NpmRegistryError("INVALID_REQUEST", "Invalid downloads end date");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || formatDateOnly(date) !== value) {
    throw new NpmRegistryError("INVALID_REQUEST", "Invalid downloads end date");
  }
  return date;
}

function previousUtcDay(now: Date): Date {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - 1);
  return date;
}

export function selectPackageVersion(
  packument: NpmPackument,
  versionOrTag = "latest",
): NpmPackageVersion {
  const version = packument["dist-tags"][versionOrTag] ?? versionOrTag;
  const metadata = packument.versions[version];
  if (!metadata) throw new NpmRegistryError("NOT_FOUND", `npm version not found: ${versionOrTag}`);
  return metadata;
}
