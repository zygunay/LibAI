import { describe, expect, it } from "vitest";

import { buildRepositorySearchRequest } from "./search.js";

describe("GitHub repository search query builder", () => {
  it("builds a deterministic language and topic-filtered request", () => {
    expect(
      buildRepositorySearchRequest({
        text: "  React   chart  ",
        language: "TypeScript",
        topics: ["Data-Viz", "react", "react"],
        forks: "exclude",
        perPage: 50,
        sort: "stars",
      }),
    ).toMatchInlineSnapshot(`
      {
        "path": "/search/repositories",
        "query": {
          "order": "desc",
          "page": 1,
          "per_page": 50,
          "q": "React chart language:TypeScript topic:data-viz topic:react",
          "sort": "stars",
        },
      }
    `);
  });

  it.each([
    ["exclude", "logger language:JavaScript"],
    ["include", "logger language:JavaScript fork:true"],
    ["only", "logger language:JavaScript fork:only"],
  ] as const)("maps the %s fork policy without ambiguity", (forks, expected) => {
    expect(buildRepositorySearchRequest({ text: "logger", language: "JavaScript", forks })).toEqual(
      expect.objectContaining({ query: expect.objectContaining({ q: expected }) }),
    );
  });

  it("quotes injected qualifiers as search text", () => {
    const request = buildRepositorySearchRequest({
      text: "logger language:ruby",
      topics: ["nodejs"],
    });
    expect(request.query.q).toBe('logger "language:ruby" topic:nodejs');
  });

  it("rejects invalid pagination, topics and oversized queries", () => {
    expect(() => buildRepositorySearchRequest({ text: "logger", perPage: 101 })).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(() =>
      buildRepositorySearchRequest({ text: "logger", topics: ["not valid"] }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
    expect(() => buildRepositorySearchRequest({ text: "x".repeat(181) })).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});
