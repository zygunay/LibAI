import type { SearchIntent } from "@libai/domain";

const SYNONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  erişilebilir: ["accessible", "a11y"],
  grafik: ["chart", "visualization"],
  kuyruk: ["queue", "job queue"],
  loglama: ["logging", "logger"],
  önbellek: ["cache", "caching"],
  tarayıcı: ["browser", "client-side"],
  auth: ["authentication", "authorization"],
  csv: ["comma-separated values", "tabular data"],
  logging: ["logger", "structured log"],
  pdf: ["pdf generation", "document generator"],
  validate: ["validation", "schema validator"],
});

export type ExpandedQuery = Readonly<{
  base: string;
  terms: readonly string[];
  queries: readonly string[];
}>;

export function expandQuery(intent: SearchIntent, maximumQueries = 6): ExpandedQuery {
  const terms = Object.entries(SYNONYMS)
    .filter(([term]) => intent.normalizedQuery.includes(term))
    .flatMap(([, synonyms]) => synonyms)
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, Math.max(0, maximumQueries - 1));
  const queries = [intent.normalizedQuery, ...terms.map((term) => `${intent.task} ${term}`)].slice(
    0,
    maximumQueries,
  );
  return Object.freeze({ base: intent.normalizedQuery, terms, queries });
}
