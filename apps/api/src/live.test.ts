import type { GitHubDiscovery } from "@libai/github";
import { parseIntent } from "@libai/intent";
import type { ModelProvider } from "@libai/model";
import type { NpmPackument, NpmRegistryAdapter, NpmSearchHit } from "@libai/npm-registry";
import { describe, expect, it } from "vitest";

import { createLiveRecommendationService } from "./live.js";

const fetchedAt = "2026-08-28T10:00:00.000Z";

function packument(name: string, description: string): NpmPackument {
  return {
    name,
    description,
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        name,
        version: "1.0.0",
        license: "MIT",
        repository: { type: "git", url: `https://github.com/acme/${name}.git` },
        engines: { node: ">=18" },
        types: "index.d.ts",
      },
    },
    sourceUrl: `https://registry.npmjs.org/${name}`,
    fetchedAt,
  };
}

function registry(): NpmRegistryAdapter {
  return {
    search: async (query) => {
      const name = query.includes("pdf") ? "pdf-live" : "logger-live";
      const hit: NpmSearchHit = {
        name,
        version: "1.0.0",
        description: `${name} description`,
        keywords: [name.includes("pdf") ? "pdf" : "logger", "typescript"],
        score: 0.92,
        date: fetchedAt,
      };
      return {
        objects: [hit],
        total: 1,
        sourceUrl: `https://registry.npmjs.org/-/v1/search?text=${name}`,
        fetchedAt,
      };
    },
    getPackument: async (name) => packument(name, `${name} description`),
    getWeeklyDownloads: async (name) => ({
      packageName: name,
      downloads: name.includes("pdf") ? 2_000 : 5_000,
      start: "2026-08-21",
      end: "2026-08-27",
      sourceUrl: `https://api.npmjs.org/downloads/point/week/${name}`,
      fetchedAt,
    }),
  };
}

function github(): Pick<GitHubDiscovery, "repository" | "activity" | "readme"> {
  return {
    repository: async (owner, repo) => ({
      data: {
        identity: {
          owner,
          name: repo,
          fullName: `${owner}/${repo}`,
          url: `https://github.com/${owner}/${repo}`,
        },
        description: `${repo} repository`,
        stars: repo.includes("pdf") ? 200 : 500,
        forks: 10,
        openIssues: 2,
        archived: false,
        fork: false,
        template: false,
        defaultBranch: "main",
        pushedAt: "2026-08-27T00:00:00.000Z",
      },
      sourceUrl: `https://api.github.com/repos/${owner}/${repo}`,
      fetchedAt,
      rateLimit: { limit: 60, remaining: 59, resetAt: null },
    }),
    activity: async () => ({
      lastCommitAt: "2026-08-27T00:00:00.000Z",
      latestReleaseAt: null,
      daysSinceCommit: 1,
      daysSinceRelease: null,
      releaseStatus: "missing",
    }),
    readme: async () => ({
      text: "Usage example",
      bytes: 5_000,
      truncated: false,
      trust: "untrusted",
      status: "present",
    }),
  };
}

const model: ModelProvider = {
  health: async () => ({ available: true, provider: "ollama", model: "test" }),
  generate: async (request) => {
    if (request.system.includes("relevance gate")) {
      const allowlist = request.prompt
        .split("CANDIDATE_ALLOWLIST\n")[1]
        ?.split("\n")[0]
        ?.split(",")
        .filter(Boolean);
      return {
        model: "test",
        text: JSON.stringify({
          assessments: (allowlist ?? []).map((candidateId) => ({
            candidateId,
            verdict: "relevant",
            fit: 90,
            reason: "Direct test fixture match.",
          })),
        }),
      };
    }
    return {
      model: "test",
      text: JSON.stringify({
        summary: request.prompt.includes("pdf-live")
          ? "Live PDF recommendation."
          : "Live logger recommendation.",
      }),
    };
  },
};

describe("live recommendation composition", () => {
  it("returns query-specific registry candidates with Ollama explanations", async () => {
    const service = createLiveRecommendationService({
      registry: registry(),
      github: github(),
      model,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "test",
      now: () => new Date("2026-08-28T12:00:00.000Z"),
    });

    const logger = await service.recommend(parseIntent("Node logger"), "live-logger");
    const pdf = await service.recommend(parseIntent("PDF parser"), "live-pdf");

    expect(logger.recommendations[0]).toMatchObject({
      candidateId: "npm:logger-live",
      generatedBy: "ollama",
      summary: "Live logger recommendation.",
      details: { weeklyDownloads: 5_000 },
    });
    expect(pdf.recommendations[0]).toMatchObject({
      candidateId: "npm:pdf-live",
      generatedBy: "ollama",
      summary: "Live PDF recommendation.",
      details: { weeklyDownloads: 2_000 },
    });
  });

  it("keeps live discovery working when Ollama is unavailable", async () => {
    const service = createLiveRecommendationService({
      registry: registry(),
      github: github(),
      model: {
        health: async () => ({ available: false, provider: "ollama", model: "test" }),
        generate: async () => {
          throw new Error("must not be called");
        },
      },
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "test",
    });

    await expect(service.recommend(parseIntent("Node logger"), "fallback")).resolves.toMatchObject({
      recommendations: [{ generatedBy: "deterministic-fallback" }],
    });
  });

  it("filters packages that only match the project noun instead of the requested capability", async () => {
    const hits: NpmSearchHit[] = [
      {
        name: "todo-wallpaper",
        version: "1.0.0",
        description: "Decorative themes for todo lists",
        keywords: ["todo", "theme"],
        score: 0.99,
        date: fetchedAt,
      },
      {
        name: "zustand-like-store",
        version: "1.0.0",
        description: "Small React state management store",
        keywords: ["react", "state-management", "store"],
        score: 0.8,
        date: fetchedAt,
      },
      {
        name: "random-weather",
        version: "1.0.0",
        description: "Weather data client",
        keywords: ["weather"],
        score: 0.75,
        date: fetchedAt,
      },
    ];
    const relevanceModel: ModelProvider = {
      health: async () => ({ available: true, provider: "ollama", model: "test" }),
      generate: async (request) => {
        if (request.system.includes("relevance gate"))
          return {
            model: "test",
            text: JSON.stringify({
              assessments: hits.map((hit) => ({
                candidateId: `npm:${hit.name}`,
                verdict: hit.name === "zustand-like-store" ? "relevant" : "irrelevant",
                fit: hit.name === "zustand-like-store" ? 96 : 12,
                reason:
                  hit.name === "zustand-like-store"
                    ? "Directly provides state management."
                    : "Does not provide state management.",
              })),
            }),
          };
        return { model: "test", text: JSON.stringify({ summary: "State management için uygun." }) };
      },
    };
    const service = createLiveRecommendationService({
      registry: {
        ...registry(),
        search: async () => ({
          objects: hits,
          total: hits.length,
          sourceUrl: "https://registry.npmjs.org/-/v1/search?text=state-management",
          fetchedAt,
        }),
      },
      github: github(),
      model: relevanceModel,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "test",
    });

    const result = await service.recommend(
      parseIntent("React todo uygulaması için state management kütüphanesi"),
      "relevance",
    );

    expect(result.recommendations.map((item) => item.candidateId)).toEqual([
      "npm:zustand-like-store",
    ]);
  });

  it("rejects an allowlist-violating model response and uses the deterministic filter", async () => {
    const unsafeModel: ModelProvider = {
      health: async () => ({ available: true, provider: "ollama", model: "test" }),
      generate: async (request) =>
        request.system.includes("relevance gate")
          ? {
              model: "test",
              text: JSON.stringify({
                assessments: [
                  {
                    candidateId: "npm:invented-package",
                    verdict: "relevant",
                    fit: 100,
                    reason: "Invented candidate.",
                  },
                ],
              }),
            }
          : { model: "test", text: JSON.stringify({ summary: "Fallback candidate summary." }) },
    };
    const service = createLiveRecommendationService({
      registry: registry(),
      github: github(),
      model: unsafeModel,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "test",
    });

    const result = await service.recommend(parseIntent("Node logger"), "allowlist");

    expect(result.recommendations.map((item) => item.candidateId)).toEqual(["npm:logger-live"]);
    expect(result.warnings).toContain(
      "The Ollama relevance response was invalid; deterministic filtering was used.",
    );
  });
});
