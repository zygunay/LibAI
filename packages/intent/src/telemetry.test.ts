import { IntentTelemetryEventValidator } from "@libai/domain";
import { describe, expect, it } from "vitest";

import { parseIntent } from "./parser.js";
import { createSearchPlan } from "./plan.js";
import { createIntentTelemetry } from "./telemetry.js";

describe("intent telemetry contract", () => {
  it("emits allowlisted aggregates without raw query, PII or secrets", () => {
    const raw = "alice@example.com için logger token=very-secret";
    const intent = parseIntent(raw);
    const event = createIntentTelemetry(intent, {
      requestId: "request-1",
      occurredAt: "2026-08-28T00:00:00.000Z",
      plan: createSearchPlan(intent),
    });
    const serialized = JSON.stringify(event);
    expect(IntentTelemetryEventValidator.Check(event)).toBe(true);
    expect(serialized).not.toContain(raw);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("very-secret");
    expect(event.sourceQueryCounts).toEqual({ npm: 3, github: 3 });
  });
});
