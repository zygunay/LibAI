import { describe, expect, it } from "vitest";

import { normalizeQuery } from "./normalize.js";
import { parseIntent } from "./parser.js";

describe("Turkish and English normalization", () => {
  it("maps equivalent bilingual queries onto one canonical form", () => {
    expect(normalizeQuery("Tarayıcı için grafik kütüphanesi")).toBe("browser chart package");
    expect(normalizeQuery("Browser chart library")).toBe("browser chart package");
  });

  it("produces equivalent task and constraints across languages", () => {
    const tr = parseIntent("Tarayıcı için grafik kütüphanesi");
    const en = parseIntent("Browser chart library");
    expect({ taskType: tr.taskType, task: tr.task, constraints: tr.constraints }).toEqual({
      taskType: en.taskType,
      task: en.task,
      constraints: en.constraints,
    });
    expect([tr.language, en.language]).toEqual(["tr", "en"]);
  });
});
