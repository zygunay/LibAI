import { describe, expect, it } from "vitest";

import { parseIntent } from "./parser.js";

describe("deterministic intent parser", () => {
  it("returns byte-equivalent JSON for the same query", () => {
    const query = "Browser için MIT lisanslı hafif grafik kütüphanesi";
    expect(JSON.stringify(parseIntent(query))).toBe(JSON.stringify(parseIntent(query)));
  });

  it("classifies a task and preserves the original query", () => {
    const intent = parseIntent("Moment yerine TypeScript ESM alternatif");
    expect(intent).toMatchObject({
      query: "Moment yerine TypeScript ESM alternatif",
      language: "tr",
      taskType: "replace",
      task: "find a replacement dependency",
    });
  });

  it("asks instead of silently assuming missing task and runtime", () => {
    const intent = parseIntent("Bana iyi bir kütüphane öner");
    expect(intent.clarificationNeeded).toBe(true);
    expect(intent.missingFields).toEqual(["task", "runtime"]);
    expect(intent.ambiguities.map((item) => item.field)).toEqual(["task", "runtime"]);
  });

  it("turns vague performance words into an explicit question", () => {
    const intent = parseIntent("Node için hafif grafik kütüphanesi");
    expect(intent.missingFields).toContain("performance");
    expect(intent.ambiguities).toContainEqual(expect.objectContaining({ field: "performance" }));
  });
});
