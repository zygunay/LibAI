import type { GitHubQueryValue } from "./adapter.js";
import { GitHubError } from "./adapter.js";

export type RepositoryForkFilter = "exclude" | "include" | "only";
export type RepositorySearchSort = "stars" | "forks" | "help-wanted-issues" | "updated";

export type RepositorySearchInput = Readonly<{
  text: string;
  language?: string;
  topics?: readonly string[];
  forks?: RepositoryForkFilter;
  page?: number;
  perPage?: number;
  sort?: RepositorySearchSort;
  order?: "asc" | "desc";
}>;

export type RepositorySearchRequest = Readonly<{
  path: "/search/repositories";
  query: Readonly<Record<string, GitHubQueryValue>>;
}>;

export function buildRepositorySearchRequest(
  input: RepositorySearchInput,
): RepositorySearchRequest {
  const page = input.page ?? 1;
  const perPage = input.perPage ?? 30;
  if (!Number.isInteger(page) || page < 1 || page > 1_000) {
    throw new GitHubError("INVALID_REQUEST", "GitHub search page must be between 1 and 1000");
  }
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    throw new GitHubError("INVALID_REQUEST", "GitHub search page size must be between 1 and 100");
  }
  if (input.order !== undefined && input.sort === undefined) {
    throw new GitHubError("INVALID_REQUEST", "GitHub search order requires a sort field");
  }

  const parts = [normalizeSearchText(input.text)];
  if (input.language !== undefined) parts.push(`language:${normalizeLanguage(input.language)}`);

  const topics = [...new Set((input.topics ?? []).map(normalizeTopic))].sort();
  if (topics.length > 5) {
    throw new GitHubError("INVALID_REQUEST", "GitHub search supports at most five topic filters");
  }
  parts.push(...topics.map((topic) => `topic:${topic}`));

  const forks = input.forks ?? "exclude";
  if (forks === "include") parts.push("fork:true");
  if (forks === "only") parts.push("fork:only");

  const q = parts.join(" ");
  if (q.length > 256) {
    throw new GitHubError("INVALID_REQUEST", "GitHub search query exceeds 256 characters");
  }

  return {
    path: "/search/repositories",
    query: {
      q,
      page,
      per_page: perPage,
      ...(input.sort ? { sort: input.sort, order: input.order ?? "desc" } : {}),
    },
  };
}

function normalizeSearchText(value: string): string {
  const text = value.trim().replace(/\s+/gu, " ");
  if (!text || text.length > 180 || hasControlCharacters(text)) {
    throw new GitHubError("INVALID_REQUEST", "GitHub search text is invalid");
  }
  return text
    .split(" ")
    .map((term) => (/^[\p{L}\p{N}@._+\-#]+$/u.test(term) ? term : quoteTerm(term)))
    .join(" ");
}

function normalizeLanguage(value: string): string {
  const language = value.trim().replace(/\s+/gu, " ");
  if (!/^[\p{L}\p{N}#+. -]{1,50}$/u.test(language)) {
    throw new GitHubError("INVALID_REQUEST", "GitHub language filter is invalid");
  }
  return language.includes(" ") ? quoteTerm(language) : language;
}

function normalizeTopic(value: string): string {
  const topic = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/u.test(topic)) {
    throw new GitHubError("INVALID_REQUEST", "GitHub topic filter is invalid");
  }
  return topic;
}

function quoteTerm(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
