export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (limit < 1 || windowMs < 1) throw new Error("Invalid rate-limit policy");
  }
  allow(key: string): Readonly<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
    const timestamp = this.now();
    const active = (this.hits.get(key) ?? []).filter((value) => timestamp - value < this.windowMs);
    if (active.length >= this.limit)
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, this.windowMs - (timestamp - (active[0] ?? timestamp))),
      };
    active.push(timestamp);
    this.hits.set(key, active);
    return { allowed: true, remaining: this.limit - active.length, retryAfterMs: 0 };
  }
}
export class MetricRegistry {
  private counters = new Map<string, number>();
  increment(name: string, labels: Readonly<Record<string, string>> = {}): void {
    const key = `${name}${Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, value]) => `${field}=${value}`)
      .join(",")}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
  render(): string {
    return [...this.counters]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key} ${value}`)
      .join("\n");
  }
}
export function retentionCutoff(now: Date, days: number): string {
  if (!Number.isInteger(days) || days < 1) throw new Error("Invalid retention period");
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
export function evaluateAvailabilityAlert(successes: number, total: number): "firing" | "resolved" {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(total) ||
    successes < 0 ||
    total < 1 ||
    successes > total
  )
    throw new Error("Invalid availability sample");
  return successes / total < 0.98 ? "firing" : "resolved";
}
