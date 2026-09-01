const CANONICAL_TERMS: readonly (readonly [RegExp, string])[] = [
  [/(?:tarayıcı|\bbrowser\b)/gu, "browser"],
  [/(?:kütüphanesi|kütüphane|\blibrary\b)/gu, "package"],
  [/(?:grafik|\bchart\b)/gu, "chart"],
  [/(?:loglama|\blogging\b|\blogger\b)/gu, "logging"],
  [/(?:erişilebilir|\baccessible\b)/gu, "accessible"],
  [/(?:çevrimdışı|\boffline\b)/gu, "offline"],
  [/(?:önbellek|\bcache\b)/gu, "cache"],
  [/(?:kuyruk|\bqueue\b)/gu, "queue"],
  [/(?:için|\bfor\b)/gu, " "],
  [/\b(ve|and)\b/gu, " "],
];

export function normalizeQuery(query: string): string {
  let normalized = query
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[“”"'`,;:!?()[\]{}]/gu, " ");
  for (const [pattern, replacement] of CANONICAL_TERMS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/gu, " ").trim();
}
