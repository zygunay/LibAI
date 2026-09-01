import { describe, expect, it } from "vitest";
import {
  analyzePackageJson,
  buildDependencyGraph,
  deletionReceipt,
  findPeerConflicts,
  inferProjectContext,
  parsePackageJson,
} from "./index.js";
const fixture = JSON.stringify({
  name: "demo",
  type: "module",
  packageManager: "pnpm@11",
  engines: { node: ">=24" },
  dependencies: { react: "^19.0.0", moment: "^2.30.0" },
  devDependencies: { vitest: "^4.0.0" },
  peerDependencies: { react: "^18.0.0" },
});
describe("dependency advisor", () => {
  it("parses bounded manifests and rejects oversized/prototype payloads", () => {
    expect(parsePackageJson(fixture).name).toBe("demo");
    expect(() => parsePackageJson("x".repeat(70_000))).toThrow("size limit");
    expect(() => parsePackageJson('{"__proto__":{}}')).toThrow("forbidden");
  });
  it("models dependency kinds and infers stack/runtime", () => {
    const doc = parsePackageJson(fixture);
    expect(buildDependencyGraph(doc)).toHaveLength(4);
    expect(inferProjectContext(doc)).toMatchObject({
      frameworks: ["React"],
      runtimes: ["Node >=24"],
      moduleFormat: "esm",
    });
  });
  it("detects declared peer-major conflicts", () => {
    expect(findPeerConflicts(buildDependencyGraph(parsePackageJson(fixture)))).toEqual([
      "react: incompatible declared majors 18, 19",
    ]);
  });
  it("prefers keeping current packages unless replacement is evidence-backed", () => {
    const report = analyzePackageJson(fixture, new Date("2026-08-28T00:00:00Z"));
    expect(report.optimizations).toContainEqual(
      expect.objectContaining({ packageName: "react", action: "keep", migrationEffort: "none" }),
    );
    expect(report.optimizations).toContainEqual(
      expect.objectContaining({
        packageName: "moment",
        action: "replace",
        alternative: "date-fns",
        migrationEffort: "medium",
      }),
    );
    expect(report.risks[0]).toHaveProperty("assessedAt");
  });
  it("returns a verifiable deletion receipt", () => {
    expect(deletionReceipt("upload_1", new Date(0))).toEqual({
      uploadId: "upload_1",
      status: "deleted",
      deletedAt: "1970-01-01T00:00:00.000Z",
    });
  });
});
