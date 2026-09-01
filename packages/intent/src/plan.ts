import type { SearchIntent, SearchPlan } from "@libai/domain";

import { expandQuery } from "./expand.js";

function groupFilters(intent: SearchIntent): Record<string, string[]> {
  const filters: Record<string, string[]> = {};
  for (const constraint of intent.constraints) {
    const key = `${constraint.operator}:${constraint.kind}`;
    const values = filters[key] ?? [];
    values.push(constraint.value);
    filters[key] = values;
  }
  return filters;
}

export function createSearchPlan(intent: SearchIntent): SearchPlan {
  const expanded = expandQuery(intent);
  const filters = groupFilters(intent);
  const featureTerms = intent.constraints
    .filter((constraint) => constraint.kind === "feature" && constraint.operator !== "excluded")
    .map((constraint) => constraint.value);
  const githubQueries = expanded.queries.map((query) =>
    [query, ...featureTerms.map((term) => `topic:${term}`)].join(" "),
  );
  return {
    schemaVersion: "1",
    intentSchemaVersion: intent.schemaVersion,
    strategy: "deterministic-v1",
    sources: [
      { source: "npm", queries: [...expanded.queries], filters, limit: 25 },
      { source: "github", queries: githubQueries, filters, limit: 25 },
    ],
  };
}
