import type { IntentTelemetryEvent, SearchIntent, SearchPlan } from "@libai/domain";

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createIntentTelemetry(
  intent: SearchIntent,
  context: Readonly<{ requestId: string; occurredAt: string; plan?: SearchPlan }>,
): IntentTelemetryEvent {
  const sourceQueryCounts = context.plan
    ? {
        npm: context.plan.sources.find((source) => source.source === "npm")?.queries.length ?? 0,
        github:
          context.plan.sources.find((source) => source.source === "github")?.queries.length ?? 0,
      }
    : undefined;
  return {
    schemaVersion: "1",
    eventType: context.plan ? "search_plan.created" : "intent.parsed",
    occurredAt: context.occurredAt,
    requestId: context.requestId,
    queryFingerprint: fingerprint(intent.normalizedQuery),
    language: intent.language,
    taskType: intent.taskType,
    clarificationNeeded: intent.clarificationNeeded,
    ...(sourceQueryCounts ? { sourceQueryCounts } : {}),
  };
}
