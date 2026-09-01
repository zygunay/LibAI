import { describe, expect, it } from "vitest";

import { expandQuery } from "./expand.js";
import { parseIntent } from "./parser.js";

describe("controlled query expansion", () => {
  it("expands only known technical synonyms in stable order", () => {
    expect(expandQuery(parseIntent("Node logger ve PDF üretme"))).toEqual({
      base: "node logging pdf üretme",
      terms: ["logger", "structured log", "pdf generation", "document generator"],
      queries: [
        "node logging pdf üretme",
        "observe application behavior logger",
        "observe application behavior structured log",
        "observe application behavior pdf generation",
        "observe application behavior document generator",
      ],
    });
  });

  it("does not invent expansions for unknown terms", () => {
    expect(expandQuery(parseIntent("Node için xyzzy"))).toMatchObject({ terms: [] });
  });
});
