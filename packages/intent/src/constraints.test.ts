import { describe, expect, it } from "vitest";

import { extractConstraints } from "./constraints.js";

describe("constraint dictionary", () => {
  it("separates runtime, license and performance constraints", () => {
    expect(extractConstraints("browser için mit lisanslı hafif grafik")).toEqual([
      { kind: "runtime", operator: "required", value: "browser" },
      { kind: "license", operator: "required", value: "MIT" },
      { kind: "performance", operator: "required", value: "lightweight" },
    ]);
  });

  it("recognizes exclusions and preferences", () => {
    expect(extractConstraints("express olsun redis olmasın tercihen typescript")).toEqual([
      { kind: "framework", operator: "required", value: "express" },
      { kind: "feature", operator: "preferred", value: "typescript" },
    ]);
  });
});
