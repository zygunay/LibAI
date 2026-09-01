import type { Constraint } from "@libai/domain";

export type ConstraintRule = Readonly<{
  aliases: readonly string[];
  kind: Constraint["kind"];
  value: string;
}>;

export const CONSTRAINT_DICTIONARY: readonly ConstraintRule[] = Object.freeze([
  { aliases: ["node", "nodejs", "node.js"], kind: "runtime", value: "node" },
  { aliases: ["browser", "tarayıcı", "client-side"], kind: "runtime", value: "browser" },
  { aliases: ["edge", "edge runtime"], kind: "runtime", value: "edge" },
  { aliases: ["deno"], kind: "runtime", value: "deno" },
  { aliases: ["bun"], kind: "runtime", value: "bun" },
  { aliases: ["react", "reactjs"], kind: "framework", value: "react" },
  { aliases: ["next", "nextjs", "next.js"], kind: "framework", value: "next" },
  { aliases: ["vue", "vuejs"], kind: "framework", value: "vue" },
  { aliases: ["express", "expressjs"], kind: "framework", value: "express" },
  { aliases: ["mit", "mit lisanslı", "mit licensed"], kind: "license", value: "MIT" },
  { aliases: ["apache-2.0", "apache 2"], kind: "license", value: "Apache-2.0" },
  { aliases: ["gpl olmasın", "no gpl", "non-gpl"], kind: "license", value: "GPL" },
  { aliases: ["offline", "çevrimdışı"], kind: "environment", value: "offline" },
  { aliases: ["server-only", "sunucu tarafı"], kind: "environment", value: "server-only" },
  { aliases: ["client-only", "istemci tarafı"], kind: "environment", value: "client-only" },
  { aliases: ["hafif", "lightweight", "küçük bundle"], kind: "performance", value: "lightweight" },
  { aliases: ["zero dependency", "bağımlılıksız"], kind: "performance", value: "zero-dependency" },
  { aliases: ["hızlı başlangıç", "fast startup"], kind: "performance", value: "fast-startup" },
  { aliases: ["typescript", "type-safe", "tip güvenli"], kind: "feature", value: "typescript" },
  { aliases: ["esm", "es module"], kind: "feature", value: "esm" },
  { aliases: ["accessible", "erişilebilir", "a11y"], kind: "feature", value: "accessible" },
]);

const EXCLUSION_MARKERS = ["olmasın", "istemiyorum", "without", "exclude", "no "];
const PREFERENCE_MARKERS = ["tercihen", "olsa iyi", "prefer", "ideally"];

export function extractConstraints(normalizedQuery: string): Constraint[] {
  const matches: Constraint[] = [];
  for (const rule of CONSTRAINT_DICTIONARY) {
    const alias = rule.aliases.find((candidate) => normalizedQuery.includes(candidate));
    if (!alias) continue;
    const position = normalizedQuery.indexOf(alias);
    const context = normalizedQuery.slice(Math.max(0, position - 14), position + alias.length + 14);
    const operator = EXCLUSION_MARKERS.some((marker) => context.includes(marker))
      ? "excluded"
      : PREFERENCE_MARKERS.some((marker) => context.includes(marker))
        ? "preferred"
        : "required";
    const constraint = { kind: rule.kind, operator, value: rule.value } as const;
    if (!matches.some((item) => item.kind === constraint.kind && item.value === constraint.value)) {
      matches.push(constraint);
    }
  }
  return matches;
}
