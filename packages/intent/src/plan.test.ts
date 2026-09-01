import { SearchPlanValidator } from "@libai/domain";
import { describe, expect, it } from "vitest";

import { parseIntent } from "./parser.js";
import { createSearchPlan } from "./plan.js";

describe("search plan", () => {
  it("exposes source-specific queries, filters and budgets", () => {
    const plan = createSearchPlan(parseIntent("Node TypeScript logger"));
    expect(SearchPlanValidator.Check(plan)).toBe(true);
    expect(plan.sources).toEqual([
      expect.objectContaining({ source: "npm", limit: 25 }),
      expect.objectContaining({ source: "github", limit: 25 }),
    ]);
    expect(plan.sources[0]?.filters).toMatchObject({
      "required:runtime": ["node"],
      "required:feature": ["typescript"],
    });
    expect(plan.sources[1]?.queries[0]).toContain("topic:typescript");
  });
});
