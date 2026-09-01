import type { NpmPackageVersion, NpmPackument } from "./adapter.js";

export type LicenseSignal = Readonly<{
  status: "single" | "multiple" | "custom" | "unknown";
  expression: string | null;
  identifiers: readonly string[];
}>;

export type PackageSizeSignal = Readonly<{
  unpackedBytes: number | null;
  fileCount: number | null;
  tier: "small" | "medium" | "large" | "unknown";
}>;

function licenseStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(licenseStrings);
  if (typeof value === "object" && value !== null && "type" in value) {
    return licenseStrings((value as { type?: unknown }).type);
  }
  return [];
}

export function extractLicenseSignal(
  packument: NpmPackument,
  version?: NpmPackageVersion,
): LicenseSignal {
  const values = licenseStrings(version?.license ?? packument.license);
  if (values.length === 0) return { status: "unknown", expression: null, identifiers: [] };
  const expression = values.join(" OR ");
  if (/^(SEE LICEN[CS]E|UNLICENSED|CUSTOM|PROPRIETARY)/iu.test(expression)) {
    return { status: "custom", expression, identifiers: [] };
  }
  const identifiers = expression
    .split(/\s+(?:AND|OR|WITH)\s+|[()]/iu)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    status: values.length > 1 || /\s(?:AND|OR)\s/iu.test(expression) ? "multiple" : "single",
    expression,
    identifiers,
  };
}

export function extractPackageSize(metadata: NpmPackageVersion): PackageSizeSignal {
  const unpackedBytes =
    typeof metadata.dist?.unpackedSize === "number" && metadata.dist.unpackedSize >= 0
      ? metadata.dist.unpackedSize
      : null;
  const fileCount =
    typeof metadata.dist?.fileCount === "number" && metadata.dist.fileCount >= 0
      ? metadata.dist.fileCount
      : null;
  const tier =
    unpackedBytes === null
      ? "unknown"
      : unpackedBytes < 100_000
        ? "small"
        : unpackedBytes < 1_000_000
          ? "medium"
          : "large";
  return { unpackedBytes, fileCount, tier };
}
