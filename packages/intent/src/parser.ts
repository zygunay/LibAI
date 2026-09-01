import type { Ambiguity, MissingField, SearchIntent, TaskType } from "@libai/domain";

import { extractConstraints } from "./constraints.js";
import { normalizeQuery } from "./normalize.js";

const TASK_RULES: readonly Readonly<{
  type: TaskType;
  objective: string;
  terms: readonly string[];
}>[] = [
  {
    type: "replace",
    objective: "find a replacement dependency",
    terms: ["yerine", "alternatif", "replace", "alternative"],
  },
  {
    type: "secure",
    objective: "secure an application",
    terms: ["auth", "sanitize", "güven", "rate limit", "crypto"],
  },
  {
    type: "observe",
    objective: "observe application behavior",
    terms: ["log", "metric", "trace", "monitor", "izle"],
  },
  { type: "test", objective: "test software", terms: ["test", "mock", "e2e", "benchmark"] },
  { type: "validate", objective: "validate input or data", terms: ["valid", "doğrula", "schema"] },
  {
    type: "automate",
    objective: "automate a workflow",
    terms: ["otomasyon", "automate", "scrape", "crawler"],
  },
  {
    type: "store",
    objective: "store or queue data",
    terms: ["database", "veritaban", "cache", "redis", "queue"],
  },
  {
    type: "present",
    objective: "present an interactive interface",
    terms: ["chart", "grafik", "picker", "editor", "component"],
  },
  {
    type: "transform",
    objective: "transform data or files",
    terms: ["convert", "çevir", "parse", "serialize"],
  },
  {
    type: "integrate",
    objective: "integrate an external service",
    terms: ["webhook", "integrate", "entegr", "client", "sdk"],
  },
  {
    type: "create",
    objective: "create an artifact or feature",
    terms: ["generate", "üret", "oluştur", "build"],
  },
  {
    type: "analyze",
    objective: "analyze or search data",
    terms: ["search", "ara", "analy", "nlp", "fuzzy"],
  },
];

export function normalizeQueryBasic(query: string): string {
  return normalizeQuery(query);
}

function detectLanguage(query: string): SearchIntent["language"] {
  if (/[çğıöşü]/iu.test(query) || /\b(için|ile|yerine|olmasın|kütüphane)\b/iu.test(query)) {
    return "tr";
  }
  if (/\b(for|with|without|library|package|to)\b/iu.test(query)) return "en";
  return "unknown";
}

function classifyTask(normalizedQuery: string): {
  taskType: TaskType;
  task: string;
  matched: boolean;
} {
  const rule = TASK_RULES.find((candidate) =>
    candidate.terms.some((term) => normalizedQuery.includes(term)),
  );
  return rule
    ? { taskType: rule.type, task: rule.objective, matched: true }
    : { taskType: "analyze", task: "find a suitable software library", matched: false };
}

export function detectUncertainty(
  normalizedQuery: string,
  taskMatched: boolean,
  constraints: SearchIntent["constraints"],
): { missingFields: MissingField[]; ambiguities: Ambiguity[] } {
  const missingFields: MissingField[] = [];
  const ambiguities: Ambiguity[] = [];
  if (!taskMatched) {
    missingFields.push("task");
    ambiguities.push({
      field: "task",
      reason: "No supported task signal was found",
      question: "What should this library help you accomplish?",
    });
  }
  if (!constraints.some((constraint) => constraint.kind === "runtime")) {
    missingFields.push("runtime");
    ambiguities.push({
      field: "runtime",
      reason: "Runtime changes package compatibility",
      question: "Which runtime must the package support: Node.js, the browser, edge, Deno, or Bun?",
    });
  }
  if (
    /\b(hafif|hızlı|lightweight|fast)\b/u.test(normalizedQuery) &&
    !/\b\d+\s*(kb|mb|ms|s)\b/u.test(normalizedQuery)
  ) {
    if (!missingFields.includes("performance")) missingFields.push("performance");
    ambiguities.push({
      field: "performance",
      reason: "The performance preference has no measurable threshold",
      question: "What measurable limit should apply to speed or bundle size?",
    });
  }
  return { missingFields, ambiguities };
}

export function parseIntent(query: string): SearchIntent {
  const normalizedQuery = normalizeQueryBasic(query);
  const classified = classifyTask(normalizedQuery);
  const constraints = extractConstraints(normalizedQuery);
  const uncertainty = detectUncertainty(normalizedQuery, classified.matched, constraints);
  return {
    schemaVersion: "1",
    query,
    normalizedQuery,
    ecosystem: "npm",
    language: detectLanguage(query),
    taskType: classified.taskType,
    task: classified.task,
    constraints,
    clarificationNeeded: uncertainty.missingFields.length > 0,
    ...uncertainty,
  };
}
