export interface CacheAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type CacheKind = "search" | "metadata" | "activity" | "readme" | "negative";
export const TTL_MS: Readonly<Record<CacheKind, number>> = {
  search: 15 * 60_000,
  metadata: 60 * 60_000,
  activity: 30 * 60_000,
  readme: 6 * 60 * 60_000,
  negative: 5 * 60_000,
};

export function cacheKey(
  namespace: string,
  kind: CacheKind,
  parts: Readonly<Record<string, string | number | boolean>>,
): string {
  const valid = /^[a-z][a-z0-9-]{0,30}$/u;
  if (!valid.test(namespace)) throw new Error("Invalid cache namespace");
  const serialized = Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value).toLowerCase())}`,
    )
    .join("&");
  return `libai:v1:${namespace}:${kind}:${serialized}`;
}

type Stored = { value: unknown; expiresAt: number };
export class MemoryCache implements CacheAdapter {
  private readonly values = new Map<string, Stored>();
  constructor(private readonly now: () => number = Date.now) {}
  async get<T>(key: string): Promise<T | undefined> {
    const item = this.values.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return item.value as T;
  }
  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("TTL must be positive");
    this.values.set(key, { value, expiresAt: this.now() + ttlMs });
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export interface RedisPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}
export class RedisCache implements CacheAdapter {
  constructor(private readonly client: RedisPort) {}
  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.client.get(key);
    return value === null ? undefined : (JSON.parse(value) as T);
  }
  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), { PX: ttlMs });
  }
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}

export type CacheableError = Readonly<{ code?: string; retryable?: boolean; status?: number }>;
export function shouldNegativeCache(error: CacheableError): boolean {
  return (
    error.retryable !== true &&
    (error.code === "NOT_FOUND" || error.status === 404 || error.code === "INVALID_REQUEST")
  );
}

export async function cached<T>(
  cache: CacheAdapter,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await coalesce(key, load);
  await cache.set(key, value, ttlMs);
  return value;
}

const inFlight = new Map<string, Promise<unknown>>();
export function coalesce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = load().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export type RetryOptions = Readonly<{
  attempts: number;
  timeoutMs: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitter?: (delayMs: number, attempt: number) => number;
  sleep?: (delayMs: number) => Promise<void>;
  retryable?: (error: unknown) => boolean;
}>;
export async function withRetry<T>(
  operation: (attempt: number, signal: AbortSignal) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.timeoutMs < 1)
    throw new Error("Invalid retry policy");
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retryable =
    options.retryable ??
    ((error) =>
      Boolean(error && typeof error === "object" && (error as { retryable?: boolean }).retryable));
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation(attempt, AbortSignal.timeout(options.timeoutMs));
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts || !retryable(error)) throw error;
      const raw = Math.min(
        options.maxDelayMs ?? Number.POSITIVE_INFINITY,
        options.baseDelayMs * 2 ** (attempt - 1),
      );
      await sleep(Math.max(0, options.jitter?.(raw, attempt) ?? raw));
    }
  }
  throw lastError;
}

export class RateBudget {
  private remaining: number;
  constructor(
    readonly limit: number,
    readonly reserve: number,
  ) {
    if (
      !Number.isInteger(limit) ||
      !Number.isInteger(reserve) ||
      limit < 1 ||
      reserve < 0 ||
      reserve >= limit
    )
      throw new Error("Invalid rate budget");
    this.remaining = limit;
  }
  update(remaining: number): void {
    if (!Number.isInteger(remaining) || remaining < 0) throw new Error("Invalid remaining budget");
    this.remaining = Math.min(this.limit, remaining);
  }
  consume(cost = 1): boolean {
    if (!Number.isInteger(cost) || cost < 1) throw new Error("Invalid request cost");
    if (this.remaining - cost < this.reserve) return false;
    this.remaining -= cost;
    return true;
  }
  snapshot(): Readonly<{ limit: number; remaining: number; reserve: number; healthy: boolean }> {
    return {
      limit: this.limit,
      remaining: this.remaining,
      reserve: this.reserve,
      healthy: this.remaining > this.reserve,
    };
  }
}

export type CircuitState = "closed" | "open" | "half-open";
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpenProbe = false;
  constructor(
    private readonly threshold: number,
    private readonly resetMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (threshold < 1 || resetMs < 1) throw new Error("Invalid circuit breaker policy");
  }
  state(): CircuitState {
    if (this.failures < this.threshold) return "closed";
    return this.now() - this.openedAt >= this.resetMs ? "half-open" : "open";
  }
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.state();
    if (state === "open" || (state === "half-open" && this.halfOpenProbe))
      throw Object.assign(new Error("Circuit is open"), { code: "CIRCUIT_OPEN", retryable: true });
    if (state === "half-open") this.halfOpenProbe = true;
    try {
      const value = await operation();
      this.failures = 0;
      this.halfOpenProbe = false;
      return value;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.threshold) this.openedAt = this.now();
      this.halfOpenProbe = false;
      throw error;
    }
  }
}

export type SourceHealth = "healthy" | "degraded" | "unavailable" | "rate-limited";
export type PartialResult<T> = Readonly<{
  status: "complete" | "partial" | "failed";
  data: Readonly<Partial<T>>;
  sources: Readonly<Record<keyof T, Readonly<{ health: SourceHealth; error?: string }>>>;
}>;
export async function collectPartial<T extends Record<string, unknown>>(
  sources: { [K in keyof T]: () => Promise<T[K]> },
): Promise<PartialResult<T>> {
  const entries = Object.entries(sources) as [keyof T, () => Promise<T[keyof T]>][];
  const settled = await Promise.allSettled(entries.map(([, load]) => load()));
  const data: Partial<T> = {};
  const health = {} as PartialResult<T>["sources"];
  let successes = 0;
  entries.forEach(([name], index) => {
    const result = settled[index];
    if (result?.status === "fulfilled") {
      data[name] = result.value;
      (health as Record<keyof T, { health: SourceHealth }>)[name] = { health: "healthy" };
      successes += 1;
    } else {
      const error = result?.reason as { code?: string; message?: string };
      (health as Record<keyof T, { health: SourceHealth; error: string }>)[name] = {
        health: error?.code === "RATE_LIMITED" ? "rate-limited" : "unavailable",
        error: error?.message ?? "Unknown source failure",
      };
    }
  });
  return {
    status: successes === entries.length ? "complete" : successes === 0 ? "failed" : "partial",
    data,
    sources: health,
  };
}
