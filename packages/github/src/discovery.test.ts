import { describe, expect, it } from "vitest";
import type { GitHubAdapter } from "./adapter.js";
import { GitHubError } from "./adapter.js";
import {
  GitHubDiscovery,
  calculateActivitySignals,
  calculateIssuePullSignals,
  decodeReadme,
  parseLanguageDistribution,
  parseLicenseSignal,
  parseRepositoryMetadata,
  parseSecuritySignals,
  parseTopics,
} from "./discovery.js";

const repo = {
  full_name: "acme/tool",
  html_url: "https://github.com/acme/tool",
  description: "tool",
  stargazers_count: 10,
  forks_count: 2,
  open_issues_count: 3,
  archived: false,
  fork: false,
  is_template: true,
  default_branch: "main",
  pushed_at: "2026-08-20T00:00:00Z",
  disabled: false,
  license: { spdx_id: "MIT", name: "MIT License" },
};

describe("GitHub discovery", () => {
  it("collects core metadata including archive/fork/template state", () => {
    expect(parseRepositoryMetadata(repo)).toMatchObject({
      archived: false,
      fork: false,
      template: true,
      identity: { fullName: "acme/tool" },
    });
  });
  it("calculates deterministic commit and release freshness", () => {
    expect(
      calculateActivitySignals(
        [{ commit: { committer: { date: "2026-08-26T00:00:00Z" } } }],
        [{ published_at: "2026-08-18T00:00:00Z" }],
        new Date("2026-08-28T00:00:00Z"),
      ),
    ).toMatchObject({ daysSinceCommit: 2, daysSinceRelease: 10, releaseStatus: "present" });
  });
  it("keeps empty issue/PR ratios unknown and computes populated ratios", () => {
    expect(
      calculateIssuePullSignals({
        openIssues: 1,
        closedIssues: 3,
        openPullRequests: 0,
        closedPullRequests: 0,
      }),
    ).toMatchObject({ issueClosureRate: 0.75, pullRequestClosureRate: null });
  });
  it("normalizes topics, language bytes, SPDX and custom license states", () => {
    expect(parseTopics({ names: ["TypeScript", "api", "api"] })).toEqual(["api", "typescript"]);
    expect(parseLanguageDistribution({ TypeScript: 100, Rust: 20 })).toEqual({
      TypeScript: 100,
      Rust: 20,
    });
    expect(parseLicenseSignal(repo)).toMatchObject({ status: "spdx", spdxId: "MIT" });
    expect(
      parseLicenseSignal({ license: { spdx_id: "NOASSERTION", name: "Custom" } }),
    ).toMatchObject({ status: "custom" });
    expect(parseLicenseSignal({ license: null })).toMatchObject({ status: "unknown" });
  });
  it("bounds README text and labels it untrusted while rejecting binary content", () => {
    expect(
      decodeReadme({ encoding: "base64", content: Buffer.from("abcdef").toString("base64") }, 3),
    ).toEqual({ text: "abc", bytes: 6, truncated: true, trust: "untrusted", status: "present" });
    expect(
      decodeReadme({ encoding: "base64", content: Buffer.from([0, 1]).toString("base64") }),
    ).toMatchObject({ status: "binary", text: null });
  });
  it("uses unknown for unavailable security signals", () => {
    expect(parseSecuritySignals(repo)).toEqual({
      securityPolicy: "unknown",
      vulnerabilityAlerts: "unknown",
      archived: false,
      disabled: false,
    });
  });
  it("runs the recorded contract and handles a missing README", async () => {
    const fake: GitHubAdapter = {
      async get<T>(requestPath: string) {
        if (requestPath.endsWith("/readme"))
          throw new GitHubError("NOT_FOUND", "missing", { status: 404 });
        return {
          data: repo as T,
          sourceUrl: `https://api.github.com${requestPath}`,
          fetchedAt: "2026-08-28T00:00:00Z",
          rateLimit: { limit: 60, remaining: 59, resetAt: null },
        };
      },
    };
    const discovery = new GitHubDiscovery(fake);
    await expect(discovery.repository("acme", "tool")).resolves.toMatchObject({
      data: { template: true },
    });
    await expect(discovery.readme("acme", "tool")).resolves.toMatchObject({
      status: "missing",
      trust: "untrusted",
    });
  });
});

const liveTest = process.env.RUN_LIVE_GITHUB_TESTS === "1" ? it : it.skip;
describe("live GitHub smoke (opt-in)", () => {
  liveTest(
    "reads an official public repository",
    async () => {
      const { GitHubClient } = await import("./client.js");
      const discovery = new GitHubDiscovery(
        new GitHubClient({ token: process.env.GITHUB_TOKEN, timeoutMs: 15_000 }),
      );
      await expect(discovery.repository("nodejs", "node")).resolves.toMatchObject({
        data: { identity: { fullName: "nodejs/node" } },
      });
    },
    30_000,
  );
});
