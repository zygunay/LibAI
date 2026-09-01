import { TaskTypeSchema } from "@libai/domain";
import { Compile } from "typebox/compile";
import { describe, expect, it } from "vitest";

import golden from "../fixtures/golden-intents.v1.json" with { type: "json" };

const TaskTypeValidator = Compile(TaskTypeSchema);

describe("golden intent dataset v1", () => {
  it("contains 40 uniquely labeled bilingual queries", () => {
    expect(golden).toHaveLength(40);
    expect(new Set(golden.map((item) => item.id)).size).toBe(40);
    expect(new Set(golden.map((item) => item.language))).toEqual(new Set(["tr", "en"]));
    expect(golden.every((item) => item.query.length >= 3)).toBe(true);
    expect(golden.every((item) => TaskTypeValidator.Check(item.taskType))).toBe(true);
  });

  it("covers every taxonomy branch", () => {
    expect(new Set(golden.map((item) => item.taskType))).toEqual(
      new Set([
        "create",
        "integrate",
        "transform",
        "validate",
        "automate",
        "observe",
        "test",
        "secure",
        "store",
        "present",
        "analyze",
        "replace",
      ]),
    );
  });
});
