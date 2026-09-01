import { describe, expect, it } from "vitest";
import {
  canonicalizeRepositoryUrl,
  createEvidence,
  deduplicateCandidates,
  evidenceSnapshot,
  freshness,
  mapNpmRepository,
  normalizeCandidate,
  unknownIfMissing,
} from "./index.js";

const at = "2026-08-28T00:00:00.000Z";
const evidence = (source: "npm" | "github", field: string, value: unknown) =>
  createEvidence({
    source,
    field,
    value,
    sourceUrl: `https://${source === "npm" ? "registry.npmjs.org/x" : "api.github.com/repos/a/x"}`,
    fetchedAt: at,
  });

describe("identity and evidence normalization", () => {
  it.each([
    "git@github.com:Acme/Tool.git",
    "git://github.com/acme/tool",
    "https://www.github.com/ACME/TOOL.git/",
  ])("canonicalizes %s", (url) => {
    expect(canonicalizeRepositoryUrl(url).url).toBe("https://github.com/acme/tool");
  });
  it("rejects unsafe or ambiguous npm mappings", () => {
    expect(mapNpmRepository("Tool", "https://gitlab.com/a/tool").repository).toBeNull();
    expect(
      mapNpmRepository("Tool", "https://github.com/a/tool", "https://github.com/b/tool").repository,
    ).toBeNull();
  });
  it("requires provenance and assigns deterministic evidence IDs", () => {
    const first = evidence("npm", "license", "MIT");
    expect(first).toMatchObject({ fetchedAt: at });
    expect(first.id).toMatch(/^ev_[a-f0-9]{8}$/u);
    expect(evidence("npm", "license", "MIT").id).toBe(first.id);
    expect(() =>
      createEvidence({
        source: "npm",
        field: "x",
        value: 1,
        sourceUrl: "http://bad",
        fetchedAt: at,
      }),
    ).toThrow();
  });
  it("models stale and missing data without converting missing to zero", () => {
    expect(freshness(at, new Date("2026-08-30T00:00:00Z"), 86_400_000)).toBe("stale");
    expect(unknownIfMissing(undefined)).toBe("unknown");
    expect(unknownIfMissing(0)).toBe(0);
  });
  it("resolves conflicts with a trace and produces a stable snapshot", () => {
    const candidate = normalizeCandidate({
      packageName: "tool",
      repositoryUrl: "https://github.com/a/tool",
      evidence: [evidence("github", "license", "Apache-2.0"), evidence("npm", "license", "MIT")],
    });
    expect(candidate.fields.license).toBe("MIT");
    expect(candidate.trace.conflicts[0]).toMatchObject({
      field: "license",
      rule: "source-priority:npm>github;then-newest",
    });
    expect(evidenceSnapshot(candidate)).toBe(evidenceSnapshot(candidate));
  });
  it("deduplicates npm and GitHub records by canonical repository", () => {
    const npm = normalizeCandidate({
      packageName: "tool",
      repositoryUrl: "https://github.com/a/tool.git",
      evidence: [evidence("npm", "version", "1.0.0")],
    });
    const github = normalizeCandidate({
      repositoryUrl: "git@github.com:a/tool.git",
      evidence: [evidence("github", "stars", 10)],
    });
    const result = deduplicateCandidates([github, npm]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "npm:tool", fields: { stars: 10, version: "1.0.0" } });
  });
});
